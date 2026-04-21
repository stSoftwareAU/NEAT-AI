/**
 * Proactive heap memory monitoring and graduated cache eviction.
 *
 * Issue #1565: Checks `Deno.memoryUsage()` once per generation and applies
 * graduated pressure responses to evict WASM caches before OOM occurs.
 *
 * Issue #2381: Adds a diagnostic retainer snapshot when heap crosses a
 * configurable `snapshotThreshold`, adaptive backoff that suppresses
 * critical-response thrash when the caches are not the retainer, and an
 * opt-in proactive GC attempt.
 *
 * Pressure levels:
 * - **Normal**: No action — caches operate at configured caps.
 * - **Warning** (≥70% heap by default): Reduce LRU cache caps by half,
 *   evict oldest activation entries.
 * - **Critical** (≥85% heap by default): Aggressively clear all
 *   non-essential caches, attempt GC if available.
 */

import type { RequiredMemoryConfig } from "@config/MemoryConfig.ts";
import {
  evictOldestWasmCreatureActivations,
  getCachedWasmActivationCount,
  getMaxCachedWasmCreatureActivations,
  getWasmActivationLruStats,
  setMaxCachedWasmCreatureActivations,
} from "@wasm/WasmCreatureActivationLRU.ts";
import {
  clearWasmCompilationCache,
  getWasmCompilationCacheStats,
  setWasmCompilationCacheSize,
} from "@wasm/WasmCompilationCache.ts";
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
  /**
   * Whether the critical response was suppressed this tick because adaptive
   * backoff is active (burst limit was exceeded within the recent window).
   * Issue #2381.
   */
  backoffActive: boolean;
  /**
   * Diagnostic snapshot captured when heap crossed `snapshotThreshold`.
   * `null` when the snapshot was not taken (below threshold or throttled).
   * Issue #2381.
   */
  snapshot: MemorySnapshot | null;
}

/**
 * Diagnostic snapshot of memory retainers. Issue #2381.
 *
 * Counts and rough byte totals for the main retainers the MemoryMonitor
 * can observe. The goal is to identify *what* is holding memory when the
 * heap is sustained above the critical threshold.
 */
export interface MemorySnapshot {
  /** Time the snapshot was taken, in ms since epoch. */
  timestampMs: number;
  /** Heap bytes currently in use (from the memory provider). */
  heapUsed: number;
  /** Heap bytes currently available (from the memory provider). */
  heapTotal: number;
  /** Resident set size in bytes, if reported by the provider. */
  rss: number;
  /** External (non-heap) bytes attributed to V8, if reported. */
  external: number;
  /** ArrayBuffer bytes attributed to V8, if reported. */
  arrayBuffers: number;
  /** Number of entries currently in the WASM activation LRU. */
  wasmActivationEntries: number;
  /** Configured cap of the WASM activation LRU. */
  wasmActivationCap: number;
  /** Number of entries currently in the WASM compilation cache. */
  wasmCompilationEntries: number;
  /** Approximate template bytes retained by the WASM compilation cache. */
  wasmCompilationBytes: number;
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

/** Rolling window of critical-response timestamps for adaptive backoff (Issue #2381). */
let _recentCriticalTimestamps: number[] = [];

/** Wall-clock time (ms) until which new critical responses are suppressed (Issue #2381). */
let _criticalBackoffUntilMs = 0;

/** Wall-clock time of the most recent diagnostic snapshot (Issue #2381). */
let _lastSnapshotAtMs = 0;

/** Whether the "entered backoff" message has already been logged for the current cooldown. */
let _backoffNotified = false;

/** Reset pressure-response log counters (for tests; module state is shared across a worker). */
export function resetMemoryPressureLogCountersForTests(): void {
  _criticalResponseLogCount = 0;
  _warningResponseLogCount = 0;
  _recentCriticalTimestamps = [];
  _criticalBackoffUntilMs = 0;
  _lastSnapshotAtMs = 0;
  _backoffNotified = false;
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
 * Attempt a proactive garbage collection if the runtime exposes it. Issue #2381.
 *
 * Only effective when the V8 `--expose-gc` flag is set. Safe to call
 * unconditionally — the call is a no-op otherwise.
 */
export function attemptProactiveGc(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== "function") return false;
  try {
    gc();
    return true;
  } catch {
    return false;
  }
}

/**
 * Provider function for heap memory usage — injectable for testing.
 */
export type MemoryUsageProvider = () => MemoryUsageSample;

/**
 * Raw sample from a memory usage provider.
 *
 * `rss`, `external`, and `arrayBuffers` are optional so existing callers that
 * only supply `heapUsed` / `heapTotal` continue to work (Issue #2381).
 */
export interface MemoryUsageSample {
  heapUsed: number;
  heapTotal: number;
  rss?: number;
  external?: number;
  arrayBuffers?: number;
}

/** Injectable clock for deterministic tests (Issue #2381). */
export type Clock = () => number;

/**
 * Default provider using `Deno.memoryUsage()`.
 */
export function defaultMemoryUsageProvider(): MemoryUsageSample {
  const mem = Deno.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
  };
}

/**
 * Capture a diagnostic retainer snapshot. Issue #2381.
 *
 * Pure reader — does not mutate any cache state.
 */
export function captureMemorySnapshot(
  sample: MemoryUsageSample,
  now: number = Date.now(),
): MemorySnapshot {
  const compilationStats = getWasmCompilationCacheStats();
  const activationStats = getWasmActivationLruStats();
  return {
    timestampMs: now,
    heapUsed: sample.heapUsed,
    heapTotal: sample.heapTotal,
    rss: sample.rss ?? 0,
    external: sample.external ?? 0,
    arrayBuffers: sample.arrayBuffers ?? 0,
    wasmActivationEntries: getCachedWasmActivationCount(),
    wasmActivationCap: activationStats.maxSize,
    wasmCompilationEntries: compilationStats.size,
    wasmCompilationBytes: compilationStats.totalBytes,
  };
}

function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/**
 * Format a memory snapshot as a single-line log entry. Issue #2381.
 */
export function formatMemorySnapshot(snapshot: MemorySnapshot): string {
  return `[MemoryMonitor] Snapshot: heap=${formatMB(snapshot.heapUsed)}/` +
    `${formatMB(snapshot.heapTotal)} rss=${formatMB(snapshot.rss)} ` +
    `external=${formatMB(snapshot.external)} ` +
    `wasmActivation=${snapshot.wasmActivationEntries}/${snapshot.wasmActivationCap} ` +
    `wasmCompilation=${snapshot.wasmCompilationEntries} ` +
    `(${formatMB(snapshot.wasmCompilationBytes)})`;
}

/**
 * Check heap memory and apply graduated eviction if thresholds are exceeded.
 *
 * Called once per generation from the evolution loop.
 *
 * Issue #2381 adds:
 * - A diagnostic snapshot when `usageFraction >= snapshotThreshold` (throttled
 *   by `snapshotIntervalMs`).
 * - Adaptive backoff: after `criticalBackoffBurst` critical responses within
 *   `criticalBackoffWindowMs`, the critical response is suppressed for
 *   `criticalBackoffCooldownMs` so we stop thrashing when caches are not the
 *   true retainer.
 * - Optional proactive GC (`proactiveGc`) invoked on critical pressure.
 *
 * @param config - Memory monitoring configuration with thresholds
 * @param logger - Logger instance for diagnostics
 * @param memoryProvider - Optional custom memory provider (for testing)
 * @param clock - Optional clock for deterministic tests
 * @returns Diagnostics about the check and any actions taken
 */
export function checkMemoryAndEvict(
  config: RequiredMemoryConfig,
  logger: Logger,
  memoryProvider?: MemoryUsageProvider,
  clock?: Clock,
): MemoryCheckResult {
  const provider = memoryProvider ?? defaultMemoryUsageProvider;
  const now = clock ?? Date.now;
  const sample = provider();
  const { heapUsed, heapTotal } = sample;

  const usageFraction = heapTotal > 0 ? heapUsed / heapTotal : 0;
  const pressureLevel = determinePressureLevel(usageFraction, config);

  let evicted = false;
  let backoffActive = false;
  let snapshot: MemorySnapshot | null = null;

  // Capture diagnostic snapshot when heap crosses the configurable threshold,
  // throttled by `snapshotIntervalMs` so we do not flood the log.
  const nowMs = now();
  const shouldSnapshot = config.enabled &&
    usageFraction >= config.snapshotThreshold &&
    heapTotal > 0 &&
    (nowMs - _lastSnapshotAtMs) >= config.snapshotIntervalMs;

  if (shouldSnapshot) {
    snapshot = captureMemorySnapshot(sample, nowMs);
    _lastSnapshotAtMs = nowMs;
    logger.warn(formatMemorySnapshot(snapshot));
  }

  if (config.enabled) {
    if (pressureLevel === "critical") {
      // Trim stale timestamps outside the rolling window.
      const windowStart = nowMs - config.criticalBackoffWindowMs;
      _recentCriticalTimestamps = _recentCriticalTimestamps.filter(
        (ts) => ts >= windowStart,
      );

      // If we are inside an active cooldown, skip the critical response.
      if (nowMs < _criticalBackoffUntilMs) {
        backoffActive = true;
        if (!_backoffNotified) {
          _backoffNotified = true;
          const remaining = Math.ceil(
            (_criticalBackoffUntilMs - nowMs) / 1000,
          );
          logger.warn(
            `[MemoryMonitor] Critical-response backoff active: skipping ` +
              `cache eviction for ~${remaining}s (caches appear not to be ` +
              `the retainer — see snapshot above)`,
          );
        }
      } else {
        // Cooldown has expired — reset the notification flag.
        _backoffNotified = false;

        applyCriticalResponse(logger);
        if (config.proactiveGc) attemptProactiveGc();
        evicted = true;

        _recentCriticalTimestamps.push(nowMs);

        // If the burst limit is exceeded within the window, arm the cooldown.
        if (_recentCriticalTimestamps.length > config.criticalBackoffBurst) {
          _criticalBackoffUntilMs = nowMs + config.criticalBackoffCooldownMs;
          _recentCriticalTimestamps = [];
          logger.warn(
            `[MemoryMonitor] Critical-response burst limit ` +
              `(${config.criticalBackoffBurst}) exceeded within ` +
              `${config.criticalBackoffWindowMs}ms — suppressing further ` +
              `critical responses for ` +
              `${config.criticalBackoffCooldownMs}ms to avoid thrashing`,
          );
        }
      }
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
    backoffActive,
    snapshot,
  };
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
