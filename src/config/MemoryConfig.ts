/**
 * Configuration for proactive heap memory monitoring and cache eviction.
 *
 * Issue #1565: The GRQ trainer repeatedly hits memory pressure (~75% of heap),
 * triggering reactive cache clearing. This config enables proactive monitoring
 * with graduated pressure responses (warning vs critical) to evict caches
 * before OOM occurs.
 *
 * Issue #2381: Adds adaptive critical-response backoff and a diagnostic
 * retainer snapshot that fires when heap crosses `snapshotThreshold`, so we
 * can identify *what* is holding memory rather than thrashing caches every
 * few seconds.
 */

/**
 * Configuration for heap memory monitoring.
 *
 * All fields are optional; defaults are applied in `createNeatConfig()`.
 */
export interface MemoryConfig {
  /**
   * Whether heap memory monitoring is enabled.
   *
   * When enabled, `Deno.memoryUsage()` is checked at least once per
   * generation and proactive cache eviction is triggered when thresholds
   * are exceeded.
   *
   * Defaults to true.
   */
  enabled?: boolean;

  /**
   * Warning threshold as a fraction of heap total (0–1).
   *
   * When heap usage exceeds this fraction, the warning-level response is
   * triggered: LRU cache caps are reduced and oldest entries are evicted.
   *
   * Defaults to 0.70 (70%).
   */
  warningThreshold?: number;

  /**
   * Critical threshold as a fraction of heap total (0–1).
   *
   * When heap usage exceeds this fraction, the critical-level response is
   * triggered: all non-essential caches are aggressively cleared.
   *
   * Defaults to 0.85 (85%).
   */
  criticalThreshold?: number;

  /**
   * Snapshot threshold as a fraction of heap total (0–1). Issue #2381.
   *
   * When heap usage exceeds this fraction, a diagnostic retainer snapshot
   * is emitted (subject to `snapshotIntervalMs` throttling) showing counts
   * and bytes per retainer type (WASM activation cache, compilation cache,
   * heap MB, external bytes, rss).
   *
   * Defaults to 0.90 (90%).
   */
  snapshotThreshold?: number;

  /**
   * Minimum milliseconds between successive diagnostic snapshots. Issue #2381.
   *
   * Once a snapshot is emitted, further snapshots are throttled for at least
   * this long so the log is not flooded when heap stays above the threshold.
   *
   * Defaults to 10_000 (10 seconds).
   */
  snapshotIntervalMs?: number;

  /**
   * Burst limit for critical responses before adaptive backoff kicks in.
   * Issue #2381.
   *
   * If more than this many critical responses fire within
   * `criticalBackoffWindowMs`, subsequent critical responses are suppressed
   * for `criticalBackoffCooldownMs`. Defaults to 5.
   */
  criticalBackoffBurst?: number;

  /**
   * Rolling window (ms) for counting recent critical responses. Issue #2381.
   * Defaults to 10_000 (10 seconds).
   */
  criticalBackoffWindowMs?: number;

  /**
   * Cooldown (ms) applied once the critical-response burst limit is hit.
   * Issue #2381.
   *
   * During the cooldown the critical response (which aggressively clears
   * caches) is skipped; diagnostic snapshots and heap logging continue.
   * This stops the monitor from fighting the same fire every few seconds
   * when heap is sustainably high and the caches are not the retainer.
   *
   * Defaults to 60_000 (60 seconds).
   */
  criticalBackoffCooldownMs?: number;

  /**
   * Whether to attempt proactive GC (`globalThis.gc?.()`) on critical
   * pressure when available. Issue #2381.
   *
   * Only effective when the runtime was started with `--v8-flags=--expose-gc`.
   * Defaults to false (so production behaviour is unchanged unless opted in).
   */
  proactiveGc?: boolean;

  /**
   * Off-heap (native/Rust) resident-set budget in bytes. Issue #3025.
   *
   * The discovery worker runs on a small default V8 heap (~269 MB), so after
   * the recording phase the V8 heap fraction sits near the critical threshold
   * even though the bulk of memory is native/Rust RSS with plenty of headroom.
   * The `AnalysisHeapGuard` would then mis-classify a healthy run as CRITICAL
   * and abort analysis (see GRQ-23).
   *
   * When this is `> 0`, a worker-V8-only CRITICAL sample no longer forces an
   * abort as long as resident-set size (RSS) stays within the budget. RSS
   * exceeding the budget still aborts (genuine OOM is never masked). When the
   * provider does not report RSS the guard falls back to the legacy V8-only
   * decision so missing telemetry can never silently disable the safeguard.
   *
   * Defaults to 0, which disables off-heap awareness and preserves the legacy
   * V8-only abort behaviour.
   */
  nativeBudgetBytes?: number;
}

/**
 * Required version of MemoryConfig with all fields populated.
 */
export type RequiredMemoryConfig = Required<MemoryConfig>;

/**
 * Default values for memory monitoring configuration.
 */
export const DEFAULT_MEMORY_CONFIG: RequiredMemoryConfig = {
  enabled: true,
  warningThreshold: 0.70,
  criticalThreshold: 0.85,
  snapshotThreshold: 0.90,
  snapshotIntervalMs: 10_000,
  criticalBackoffBurst: 5,
  criticalBackoffWindowMs: 10_000,
  criticalBackoffCooldownMs: 60_000,
  proactiveGc: false,
  nativeBudgetBytes: 0,
};
