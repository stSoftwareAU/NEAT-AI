/**
 * Proactive heap memory monitoring and graduated cache eviction.
 *
 * Issue #1565: Checks `Deno.memoryUsage()` once per generation and applies
 * graduated pressure responses to evict WASM caches before OOM occurs.
 *
 * Pressure levels:
 * - **Normal**: No action — caches operate at configured caps.
 * - **Warning** (≥70% heap by default): Reduce LRU cache caps by half,
 *   evict oldest activation entries.
 * - **Critical** (≥85% heap by default): Aggressively clear all
 *   non-essential caches, attempt GC if available.
 */

import type { RequiredMemoryConfig } from "../config/MemoryConfig.ts";
import {
  evictOldestWasmCreatureActivations,
  getMaxCachedWasmCreatureActivations,
  setMaxCachedWasmCreatureActivations,
} from "../wasm/WasmCreatureActivationLRU.ts";
import {
  clearWasmCompilationCache,
  setWasmCompilationCacheSize,
} from "../wasm/WasmCompilationCache.ts";
import type { Logger } from "@utils/Logger.ts";

/**
 * Pressure level determined by heap usage relative to configured thresholds.
 */
export type PressureLevel = "normal" | "warning" | "critical";

/**
 * Result of a single memory check, including diagnostics and any actions taken.
 */
export interface MemoryCheckResult {
  /** Heap bytes currently in use. */
  heapUsed: number;
  /** Total heap bytes available. */
  heapTotal: number;
  /** Usage as a fraction of total (0–1). */
  usageFraction: number;
  /** The determined pressure level. */
  pressureLevel: PressureLevel;
  /** Whether any eviction action was taken. */
  evicted: boolean;
}

/**
 * Determine the pressure level for a given usage fraction.
 */
export function determinePressureLevel(
  usageFraction: number,
  config: RequiredMemoryConfig,
): PressureLevel {
  if (usageFraction >= config.criticalThreshold) return "critical";
  if (usageFraction >= config.warningThreshold) return "warning";
  return "normal";
}

/**
 * Apply the warning-level response: halve activation cache cap and evict
 * oldest entries to bring the cache within the new cap.
 */
export function applyWarningResponse(logger: Logger): void {
  const currentCap = getMaxCachedWasmCreatureActivations();
  const reducedCap = Math.max(1, Math.floor(currentCap / 2));
  setMaxCachedWasmCreatureActivations(reducedCap);

  // Evict a quarter of the original cap to free memory promptly
  const evictCount = Math.max(1, Math.floor(currentCap / 4));
  evictOldestWasmCreatureActivations(evictCount);

  _warningResponseLogCount++;
  if (_warningResponseLogCount % 10 !== 1) return;

  const evictedNoun = evictCount === 1 ? "entry" : "entries";

  if (reducedCap < currentCap) {
    logger.warn(
      `[MemoryMonitor] Warning-level response: reduced activation cache cap ` +
        `from ${currentCap} to ${reducedCap}, evicted ${evictCount} ${evictedNoun}`,
    );
  } else {
    logger.warn(
      `[MemoryMonitor] Warning-level response: activation cache cap already at ` +
        `minimum (${currentCap}); evicted ${evictCount} oldest ${evictedNoun}`,
    );
  }
}

/** Call counts for pressure responses; throttle log noise when thresholds stay exceeded (Issue #2070). */
let _criticalResponseLogCount = 0;
let _warningResponseLogCount = 0;

/** Reset pressure-response log counters (for tests; module state is shared across a worker). */
export function resetMemoryPressureLogCountersForTests(): void {
  _criticalResponseLogCount = 0;
  _warningResponseLogCount = 0;
}

/**
 * Apply the critical-level response: aggressively clear all non-essential
 * caches and attempt garbage collection.
 */
export function applyCriticalResponse(logger: Logger): void {
  // Shrink activation cache to minimum
  const currentCap = getMaxCachedWasmCreatureActivations();
  setMaxCachedWasmCreatureActivations(1);
  evictOldestWasmCreatureActivations(currentCap);

  // Clear compilation cache entirely
  clearWasmCompilationCache();

  // Reset compilation cache to minimum size
  setWasmCompilationCacheSize(1);

  // Throttle repeated critical messages (e.g. when heap stays high for many generations).
  _criticalResponseLogCount++;
  if (_criticalResponseLogCount % 10 === 1) {
    logger.warn(
      `[MemoryMonitor] Critical-level response: cleared all WASM caches, ` +
        `activation cap reduced to 1, compilation cache cleared`,
    );
  }
}

/**
 * Provider function for heap memory usage — injectable for testing.
 */
export type MemoryUsageProvider = () => { heapUsed: number; heapTotal: number };

/**
 * Default provider using `Deno.memoryUsage()`.
 */
export function defaultMemoryUsageProvider(): {
  heapUsed: number;
  heapTotal: number;
} {
  const mem = Deno.memoryUsage();
  return { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal };
}

/**
 * Check heap memory and apply graduated eviction if thresholds are exceeded.
 *
 * Called once per generation from the evolution loop.
 *
 * @param config - Memory monitoring configuration with thresholds
 * @param logger - Logger instance for diagnostics
 * @param memoryProvider - Optional custom memory provider (for testing)
 * @returns Diagnostics about the check and any actions taken
 */
export function checkMemoryAndEvict(
  config: RequiredMemoryConfig,
  logger: Logger,
  memoryProvider?: MemoryUsageProvider,
): MemoryCheckResult {
  const provider = memoryProvider ?? defaultMemoryUsageProvider;
  const { heapUsed, heapTotal } = provider();

  const usageFraction = heapTotal > 0 ? heapUsed / heapTotal : 0;
  const pressureLevel = determinePressureLevel(usageFraction, config);

  let evicted = false;

  if (config.enabled) {
    if (pressureLevel === "critical") {
      applyCriticalResponse(logger);
      evicted = true;
    } else if (pressureLevel === "warning") {
      applyWarningResponse(logger);
      evicted = true;
    }
  }

  return {
    heapUsed,
    heapTotal,
    usageFraction,
    pressureLevel,
    evicted,
  };
}

/**
 * Format a byte count as a human-readable string (e.g. "1,234 MB").
 */
function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/**
 * Log memory usage statistics for the current generation.
 *
 * @param result - The memory check result to log
 * @param logger - Logger instance
 */
export function logMemoryUsage(
  result: MemoryCheckResult,
  logger: Logger,
): void {
  const pct = (result.usageFraction * 100).toFixed(1);
  const levelTag = result.pressureLevel === "normal"
    ? ""
    : ` [${result.pressureLevel.toUpperCase()}]`;

  logger.info(
    `[MemoryMonitor] Heap: ${formatMB(result.heapUsed)} / ` +
      `${formatMB(result.heapTotal)} (${pct}%)${levelTag}`,
  );
}
