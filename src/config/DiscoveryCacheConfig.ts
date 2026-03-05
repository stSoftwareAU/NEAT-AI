/**
 * Configuration for discovery cache eviction behaviour.
 *
 * Issue #1701: The on-disk discovery success and failure caches grow
 * unboundedly. This config adds configurable max entry counts and
 * age-based TTL eviction to keep disk usage in check.
 */

/**
 * Configuration for discovery cache size limits and eviction.
 *
 * All fields are optional; defaults are applied in `createNeatConfig()`.
 */
export interface DiscoveryCacheConfig {
  /**
   * Maximum number of entries in the success cache.
   * When exceeded, oldest entries are evicted during pruning.
   *
   * Defaults to 10,000.
   */
  successMaxEntries?: number;

  /**
   * Maximum number of entries in the failure cache.
   * When exceeded, oldest entries are evicted during pruning.
   *
   * Defaults to 50,000.
   */
  failureMaxEntries?: number;

  /**
   * Time-to-live for cache entries in days.
   * Entries older than this are evicted during pruning.
   *
   * Applies to both success and failure caches.
   *
   * Defaults to 30 days.
   */
  ttlDays?: number;

  /**
   * Time-to-live for obsolete (archived) entries in days.
   * Archived success entries older than this are removed during pruning.
   *
   * Defaults to 7 days.
   */
  obsoleteTTLDays?: number;
}

/**
 * Required version of DiscoveryCacheConfig with all fields populated.
 */
export type RequiredDiscoveryCacheConfig = Required<DiscoveryCacheConfig>;

/**
 * Default values for discovery cache configuration.
 */
export const DEFAULT_DISCOVERY_CACHE_CONFIG: RequiredDiscoveryCacheConfig = {
  successMaxEntries: 10_000,
  failureMaxEntries: 50_000,
  ttlDays: 30,
  obsoleteTTLDays: 7,
};
