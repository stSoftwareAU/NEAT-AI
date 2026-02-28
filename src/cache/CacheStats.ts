/**
 * Cache Diagnostics Interface
 *
 * Issue #1616: Exposes hit/miss rates, eviction counts, and size metrics
 * for internal caches (WASM compilation cache, WASM activation LRU,
 * distance cache). Allows users to determine whether their cache
 * configuration is well-tuned for their workload.
 */

/**
 * Diagnostic statistics for an individual cache.
 *
 * All counters are monotonically increasing since the last cache reset.
 * The interface is intentionally lightweight — counters are simple
 * increments with no allocations on hot paths.
 */
export interface CacheStats {
  /** Human-readable name identifying the cache. */
  readonly name: string;

  /** Number of lookups that found a cached entry. */
  readonly hits: number;

  /** Number of lookups that did not find a cached entry. */
  readonly misses: number;

  /** Number of entries evicted due to capacity limits. */
  readonly evictions: number;

  /** Current number of entries in the cache. */
  readonly currentSize: number;

  /** Maximum number of entries the cache may hold. */
  readonly maxSize: number;
}
