/**
 * Unified cache diagnostics aggregator.
 *
 * Issue #1616: Collects diagnostic statistics from all instrumented
 * caches and returns them as a single array. This lets users inspect
 * hit/miss rates, eviction counts, and size metrics in one call to
 * determine whether their cache configuration is well-tuned.
 */

import type { CacheStats } from "./CacheStats.ts";
import { getDistanceCacheStats } from "../breed/DistanceCache.ts";
import { getWasmActivationLruStats } from "../wasm/WasmCreatureActivationLRU.ts";
import {
  getWasmCompilationCacheMaxSize,
  getWasmCompilationCacheStats,
} from "../wasm/WasmCompilationCache.ts";

/**
 * Return diagnostic statistics for all instrumented caches.
 *
 * Currently reports on:
 * - **WASM Compilation Cache** — caches compiled binary templates for
 *   creatures with identical topologies.
 * - **WASM Activation LRU** — bounds cached `CompiledNetwork` instances
 *   to prevent WASM heap overflow.
 * - **Distance Cache** — caches pairwise genetic compatibility distances
 *   used during speciation.
 *
 * @returns An array of {@link CacheStats}, one per instrumented cache.
 */
export function getCacheStats(): CacheStats[] {
  const compilationStats = getWasmCompilationCacheStats();

  const wasmCompilation: CacheStats = {
    name: "WASM Compilation Cache",
    hits: compilationStats.hits,
    misses: compilationStats.misses,
    evictions: compilationStats.evictions,
    currentSize: compilationStats.size,
    maxSize: getWasmCompilationCacheMaxSize(),
  };

  return [
    wasmCompilation,
    getWasmActivationLruStats(),
    getDistanceCacheStats(),
  ];
}
