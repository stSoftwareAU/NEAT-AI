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

import v8 from "node:v8";
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
import {
  clearDistanceCache,
  getDistanceCacheSize,
  getDistanceCacheStats,
} from "@breed/DistanceCache.ts";
import { getSharedSubnetworkIndex } from "@discovery/SubnetworkHashIndex.ts";
import type { WasmCacheConfig } from "@config/WasmCacheConfig.ts";
import type { Logger } from "@utils/Logger.ts";

/**
 * Sink for memory-pressure responses that must reach state the MemoryMonitor
 * module does not own directly (Issue #3431).
 *
 * The MemoryMonitor can evict main-thread WASM caches and process-global
 * breed/discovery indexes by itself, but worker isolates keep their own WASM
 * heaps that only the owning `Neat` instance can address. The evolution loop
 * supplies a sink so a CRITICAL/WARNING response also reduces worker cache caps
 * and so diagnostics can report how many worker isolates are live.
 *
 * All members are optional: when no sink is supplied (or a member is absent),
 * the monitor simply skips that action — preserving existing single-thread
 * behaviour.
 */
export interface MemoryPressureSink {
  /**
   * Broadcast reduced WASM cache caps to every live worker isolate. Called with
   * the same reduced caps the monitor applied on the main thread. Must be
   * fire-and-forget and must not throw for a dead/absent worker.
   */
  configureWorkerCaches?(config: WasmCacheConfig): void;
  /** Number of live worker isolates, each retaining its own WASM heap. */
  workerCount?(): number;
}

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
  /** Committed heap bytes (V8 `heapTotal`) — grows on demand up to the limit. */
  heapTotal: number;
  /**
   * The V8 old-space heap **limit** in bytes — the real ceiling
   * (`--max-old-space-size`, reported via `heap_size_limit`) that `heapUsed`
   * approaches before OOM. Distinct from `heapTotal`, which is only the heap
   * currently committed and grows over the run (Issue #3410). Falls back to
   * `heapTotal` when the runtime does not expose the limit.
   */
  heapLimit: number;
  /** Usage as a fraction of the heap limit (0–1). */
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
  /** Committed heap bytes (from the memory provider). */
  heapTotal: number;
  /**
   * The V8 old-space heap limit in bytes — the real OOM ceiling, not the
   * committed `heapTotal` (Issue #3410). Falls back to `heapTotal` when the
   * runtime does not expose the limit.
   */
  heapLimit: number;
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
  /**
   * Number of entries currently in the process-global breed DistanceCache.
   * A previously-invisible retainer (Issue #3431).
   */
  distanceCacheEntries: number;
  /** Configured cap of the breed DistanceCache. */
  distanceCacheMax: number;
  /**
   * Number of entries currently held by the shared discovery
   * SubnetworkHashIndex — survives across generations / repeated `evolveDir`
   * calls (Issue #3431).
   */
  subnetworkIndexEntries: number;
  /**
   * Number of live worker isolates reported by the pressure sink, each holding
   * its own WASM heap off the main-thread JS heap (Issue #3431). `0` when no
   * sink is supplied (single-thread context).
   */
  workerCount: number;
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
export function applyWarningResponse(
  logger: Logger,
  sink?: MemoryPressureSink,
): void {
  // Remember the cap so it can be restored once pressure clears (#3082).
  captureActivationCapBaseline();
  const currentCap = getMaxCachedWasmCreatureActivations();
  const reducedCap = Math.max(1, Math.floor(currentCap / 2));
  setMaxCachedWasmCreatureActivations(reducedCap);

  // Evict a quarter of the original cap to free memory promptly
  const evictCount = Math.max(1, Math.floor(currentCap / 4));
  evictOldestWasmCreatureActivations(evictCount);

  // Issue #3431: mirror the reduced activation cap onto worker isolates, which
  // keep their own WASM heaps the main-thread eviction never touches.
  broadcastWorkerCacheCaps(sink, { maxCachedActivations: reducedCap }, logger);

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

/**
 * The activation-cache cap captured the first time pressure forced a reduction,
 * so it can be RESTORED once the caches are shown not to be the retainer or
 * heap pressure clears (Issue #3082). `null` means no pressure-driven reduction
 * is currently in effect.
 *
 * Without this, a single heap spike pins the activation cap at 1 for the rest
 * of the run and evolve throughput collapses — a major contributor to the
 * GRQ-16 forex `easy` run overrunning its ~1h target. The adaptive backoff
 * (#2381) already concludes "caches appear not to be the retainer" when the
 * critical-response burst limit is exceeded; at that point continuing to pin
 * the cap at 1 achieves no memory relief and only starves throughput, so we
 * restore it.
 */
let _preReductionActivationCap: number | null = null;

/** Reset pressure-response log counters (for tests; module state is shared across a worker). */
export function resetMemoryPressureLogCountersForTests(): void {
  _criticalResponseLogCount = 0;
  _warningResponseLogCount = 0;
  _recentCriticalTimestamps = [];
  _criticalBackoffUntilMs = 0;
  _lastSnapshotAtMs = 0;
  _backoffNotified = false;
  _preReductionActivationCap = null;
}

/**
 * Remember the activation-cache cap before the first pressure-driven reduction
 * of a pressure episode so restoreActivationCapIfRecovered() can put it back.
 * Only captures a genuine baseline (> 1) and only once per episode. Issue #3082.
 */
function captureActivationCapBaseline(): void {
  if (_preReductionActivationCap !== null) return;
  const currentCap = getMaxCachedWasmCreatureActivations();
  if (currentCap > 1) {
    _preReductionActivationCap = currentCap;
  }
}

/**
 * Restore the activation-cache cap to its pre-pressure baseline (Issue #3082).
 *
 * Called when the caches have been shown not to be the retainer (adaptive
 * backoff engaged) or heap pressure has returned to normal — in both cases
 * keeping the cap pinned at 1 buys no memory relief and only collapses evolve
 * throughput. Returns true when a restoration happened.
 */
export function restoreActivationCapIfRecovered(logger: Logger): boolean {
  if (_preReductionActivationCap === null) return false;
  const baseline = _preReductionActivationCap;
  _preReductionActivationCap = null;
  if (getMaxCachedWasmCreatureActivations() >= baseline) return false;
  setMaxCachedWasmCreatureActivations(baseline);
  logger.warn(
    `[MemoryMonitor] Restored activation cache cap to ${baseline} — the caches ` +
      `were not the retainer / heap pressure cleared, so the cap was un-pinned ` +
      `to avoid throttling throughput for the rest of the run`,
  );
  return true;
}

/**
 * Apply the critical-level response: aggressively clear all non-essential
 * caches and attempt garbage collection.
 */
export function applyCriticalResponse(
  logger: Logger,
  sink?: MemoryPressureSink,
): void {
  // Remember the cap so it can be restored once pressure clears (#3082).
  captureActivationCapBaseline();
  // Shrink activation cache to minimum
  const currentCap = getMaxCachedWasmCreatureActivations();
  setMaxCachedWasmCreatureActivations(1);
  evictOldestWasmCreatureActivations(currentCap);

  // Clear compilation cache entirely
  clearWasmCompilationCache();

  // Reset compilation cache to minimum size
  setWasmCompilationCacheSize(1);

  // Issue #3431: clear process-global breed/discovery retainers that the
  // per-worker and main-thread WASM eviction never reached. These survive
  // across generations and repeated `evolveDir` calls, so they can pin RSS
  // high while the WASM caches report near-empty.
  const { distanceEntries, subnetworkEntries } = evictProcessGlobalRetainers();

  // Issue #3431: mirror the aggressively-reduced caps onto worker isolates.
  broadcastWorkerCacheCaps(
    sink,
    { maxCachedActivations: 1, compilationCacheSize: 1 },
    logger,
  );

  // Throttle repeated critical messages (e.g. when heap stays high for many generations).
  _criticalResponseLogCount++;
  if (_criticalResponseLogCount % 10 === 1) {
    logger.warn(
      `[MemoryMonitor] Critical-level response: cleared all WASM caches, ` +
        `activation cap reduced to 1, compilation cache cleared, ` +
        `DistanceCache (${distanceEntries}) and SubnetworkHashIndex ` +
        `(${subnetworkEntries}) cleared`,
    );
  }
}

/**
 * Clear the process-global breed/discovery retainers under critical pressure
 * and report how many entries each held (Issue #3431).
 *
 * These are module singletons the MemoryMonitor can address directly, unlike
 * worker WASM heaps. Returns the pre-clear entry counts for diagnostics.
 */
function evictProcessGlobalRetainers(): {
  distanceEntries: number;
  subnetworkEntries: number;
} {
  const distanceEntries = getDistanceCacheSize();
  clearDistanceCache();

  const index = getSharedSubnetworkIndex();
  const subnetworkEntries = index.count;
  index.clear();

  return { distanceEntries, subnetworkEntries };
}

/**
 * Broadcast reduced WASM cache caps to worker isolates via the pressure sink
 * (Issue #3431). Best-effort: a sink failure is logged loudly but never
 * propagated, so a dead worker cannot crash the memory monitor.
 */
function broadcastWorkerCacheCaps(
  sink: MemoryPressureSink | undefined,
  config: WasmCacheConfig,
  logger: Logger,
): void {
  if (!sink?.configureWorkerCaches) return;
  try {
    sink.configureWorkerCaches(config);
  } catch (error) {
    logger.warn(
      `[MemoryMonitor] Failed to broadcast reduced cache caps to workers: ` +
        `${error instanceof Error ? error.message : String(error)}`,
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
  /**
   * The V8 old-space heap **limit** in bytes (`heap_size_limit`) — the real
   * ceiling `heapUsed` approaches before OOM. Optional so existing callers /
   * test providers that only supply `heapUsed` / `heapTotal` keep working;
   * when absent or non-positive the limit falls back to `heapTotal`
   * (Issue #3410).
   */
  heapLimit?: number;
  rss?: number;
  external?: number;
  arrayBuffers?: number;
}

/**
 * Resolve the effective heap **limit** for a sample (Issue #3410).
 *
 * Prefers the real V8 old-space limit (`heapLimit`) when the provider reports a
 * positive, finite value; otherwise falls back to the committed `heapTotal` so
 * runtimes / test providers that cannot report the limit keep their previous
 * behaviour. This is the correct denominator for pressure thresholds: dividing
 * by the committed `heapTotal` (which starts small and grows) made the monitor
 * read CRITICAL against a tiny committed heap and blind to true OOM proximity.
 */
export function resolveHeapLimit(sample: MemoryUsageSample): number {
  const limit = sample.heapLimit;
  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    return limit;
  }
  return sample.heapTotal;
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
    // `Deno.memoryUsage()` reports the *committed* heap (`heapTotal`), which
    // starts small (~a few hundred MB) and grows over the run — it is NOT the
    // real OOM ceiling. The V8 old-space limit (`--max-old-space-size`, e.g.
    // ~4373 MB on an 8 GB host) is only exposed via `node:v8`
    // `getHeapStatistics().heap_size_limit`, so read it there (Issue #3410).
    heapLimit: readHeapSizeLimit(),
    rss: mem.rss,
    external: mem.external,
  };
}

/**
 * The current isolate's V8 old-space heap limit in bytes (Issue #3410).
 *
 * Returns `0` when `node:v8` cannot report the limit, so `resolveHeapLimit`
 * transparently falls back to the committed `heapTotal` rather than dividing by
 * a bogus value.
 */
function readHeapSizeLimit(): number {
  try {
    const limit = v8.getHeapStatistics().heap_size_limit;
    return Number.isFinite(limit) && limit > 0 ? limit : 0;
  } catch {
    return 0;
  }
}

/**
 * Capture a diagnostic retainer snapshot. Issue #2381.
 *
 * Pure reader — does not mutate any cache state.
 */
export function captureMemorySnapshot(
  sample: MemoryUsageSample,
  now: number = Date.now(),
  sink: MemoryPressureSink | undefined = undefined,
): MemorySnapshot {
  const compilationStats = getWasmCompilationCacheStats();
  const activationStats = getWasmActivationLruStats();
  const distanceStats = getDistanceCacheStats();
  return {
    timestampMs: now,
    heapUsed: sample.heapUsed,
    heapTotal: sample.heapTotal,
    heapLimit: resolveHeapLimit(sample),
    rss: sample.rss ?? 0,
    external: sample.external ?? 0,
    arrayBuffers: sample.arrayBuffers ?? 0,
    wasmActivationEntries: getCachedWasmActivationCount(),
    wasmActivationCap: activationStats.maxSize,
    wasmCompilationEntries: compilationStats.size,
    wasmCompilationBytes: compilationStats.totalBytes,
    // Issue #3431: previously-invisible process-global / worker retainers.
    distanceCacheEntries: distanceStats.currentSize,
    distanceCacheMax: distanceStats.maxSize,
    subnetworkIndexEntries: getSharedSubnetworkIndex().count,
    workerCount: sink?.workerCount?.() ?? 0,
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
    `${formatMB(snapshot.heapTotal)} limit=${formatMB(snapshot.heapLimit)} ` +
    `rss=${formatMB(snapshot.rss)} ` +
    `external=${formatMB(snapshot.external)} ` +
    `wasmActivation=${snapshot.wasmActivationEntries}/${snapshot.wasmActivationCap} ` +
    `wasmCompilation=${snapshot.wasmCompilationEntries} ` +
    `(${formatMB(snapshot.wasmCompilationBytes)}) ` +
    `distanceCache=${snapshot.distanceCacheEntries}/${snapshot.distanceCacheMax} ` +
    `subnetworkIndex=${snapshot.subnetworkIndexEntries} ` +
    `workers=${snapshot.workerCount}`;
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
 * @param sink - Optional pressure sink (Issue #3431): broadcasts reduced WASM
 *   cache caps to worker isolates on WARNING/CRITICAL and reports live worker
 *   count for diagnostics. Omit in single-thread contexts.
 * @returns Diagnostics about the check and any actions taken
 */
export function checkMemoryAndEvict(
  config: RequiredMemoryConfig,
  logger: Logger,
  memoryProvider?: MemoryUsageProvider,
  clock?: Clock,
  sink?: MemoryPressureSink,
): MemoryCheckResult {
  const provider = memoryProvider ?? defaultMemoryUsageProvider;
  const now = clock ?? Date.now;
  const sample = provider();
  const { heapUsed, heapTotal } = sample;

  // Divide by the real V8 old-space *limit*, not the committed `heapTotal`.
  // `heapTotal` grows on demand, so `heapUsed / heapTotal` reads near-full
  // against a tiny committed heap early in the run (the "676 MB" misread) and
  // never reflects true proximity to the OOM ceiling (Issue #3410).
  const heapLimit = resolveHeapLimit(sample);
  const usageFraction = heapLimit > 0 ? heapUsed / heapLimit : 0;
  const pressureLevel = determinePressureLevel(usageFraction, config);

  let evicted = false;
  let backoffActive = false;
  let snapshot: MemorySnapshot | null = null;

  // Capture diagnostic snapshot when heap crosses the configurable threshold,
  // throttled by `snapshotIntervalMs` so we do not flood the log.
  const nowMs = now();
  const shouldSnapshot = config.enabled &&
    usageFraction >= config.snapshotThreshold &&
    heapLimit > 0 &&
    (nowMs - _lastSnapshotAtMs) >= config.snapshotIntervalMs;

  if (shouldSnapshot) {
    snapshot = captureMemorySnapshot(sample, nowMs, sink);
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

        applyCriticalResponse(logger, sink);
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
          // We have now concluded the caches are not the retainer. Un-pin the
          // activation cap that applyCriticalResponse just slammed to 1 —
          // keeping it pinned buys no memory relief and only collapses evolve
          // throughput for the rest of the run (Issue #3082).
          restoreActivationCapIfRecovered(logger);
        }
      }
    } else if (pressureLevel === "warning") {
      applyWarningResponse(logger, sink);
      evicted = true;
    } else {
      // pressureLevel === "normal": heap has recovered — restore any cap that a
      // previous pressure response pinned low so throughput is not throttled
      // for the rest of the run (Issue #3082).
      restoreActivationCapIfRecovered(logger);
    }
  }

  return {
    heapUsed,
    heapTotal,
    heapLimit,
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

  // Report against the real heap *limit* so the percentage matches
  // usageFraction and the CRITICAL threshold (Issue #3410).
  logger.info(
    `[MemoryMonitor] Heap: ${formatMB(result.heapUsed)} / ` +
      `${formatMB(result.heapLimit)} (${pct}%)${levelTag}`,
  );
}
