/**
 * Configuration for proactive heap memory monitoring and cache eviction.
 *
 * Issue #1565: The GRQ trainer repeatedly hits memory pressure (~75% of heap),
 * triggering reactive cache clearing. This config enables proactive monitoring
 * with graduated pressure responses (warning vs critical) to evict caches
 * before OOM occurs.
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
};
