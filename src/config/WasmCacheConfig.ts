/**
 * Configuration for WASM cache behaviour.
 *
 * Issue #1566: The WASM LRU cache caps (creature activation cache and
 * compilation cache) were previously set via imperative function calls
 * with no integration into the standard config lifecycle. This caused
 * mismatches — e.g. a fixed activation cache of 32 with a population
 * of hundreds leads to constant eviction/recompilation churn.
 *
 * Default `maxCachedActivations` scales with `populationSize` to avoid
 * this mismatch.
 */

/**
 * Configuration for WASM cache sizing.
 *
 * Both fields are optional; defaults are applied in `createNeatConfig()`.
 */
export interface WasmCacheConfig {
  /**
   * Maximum number of cached WASM creature activations kept in the LRU.
   *
   * When omitted, defaults to `populationSize * 2` so that the cache
   * comfortably holds the full population without excessive eviction.
   */
  maxCachedActivations?: number;

  /**
   * Maximum number of entries in the WASM compilation (topology template)
   * cache.
   *
   * Defaults to 100.
   */
  compilationCacheSize?: number;
}

/**
 * Required version of WasmCacheConfig with all fields populated.
 */
export type RequiredWasmCacheConfig = Required<WasmCacheConfig>;

/**
 * Default values for WASM cache configuration.
 *
 * Note: `maxCachedActivations` here is a static fallback. In practice
 * `createNeatConfig()` computes the default relative to `populationSize`.
 */
export const DEFAULT_WASM_CACHE_CONFIG: RequiredWasmCacheConfig = {
  maxCachedActivations: 512,
  compilationCacheSize: 100,
};
