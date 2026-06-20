/**
 * LRU cache for pairwise genetic compatibility distances.
 *
 * Issue #1293: Caches computed distances between creature pairs keyed by
 * their UUIDs. Since creature UUIDs are deterministic hashes of structure,
 * a cached distance remains valid as long as neither creature's structure
 * has changed (which would produce a new UUID).
 *
 * The cache uses a canonical key (sorted UUID pair) so that
 * distance(A, B) and distance(B, A) share a single entry.
 */

import type { CacheStats } from "@cache/CacheStats.ts";

const DEFAULT_MAX_SIZE = 10_000;

/**
 * Make a canonical cache key from two UUIDs.
 * Sorting ensures (a, b) and (b, a) map to the same key.
 */
function makeCacheKey(uuidA: string, uuidB: string): string {
  return uuidA < uuidB ? `${uuidA}\0${uuidB}` : `${uuidB}\0${uuidA}`;
}

/**
 * Global distance cache instance.
 *
 * Issue #3084: `Map` preserves insertion order, so the least-recently-used
 * entry is always the first key. We exploit this for an O(1) LRU: a hit moves
 * its entry to the most-recently-used (last) position, and eviction removes the
 * first key. No per-entry `lastAccess` bookkeeping or full-cache scan is needed.
 */
const cache = new Map<string, number>();
let maxSize = DEFAULT_MAX_SIZE;

// Counters for diagnostics / benchmarking
let hits = 0;
let misses = 0;
let evictions = 0;

/**
 * Look up a cached distance for the given creature UUID pair.
 *
 * @returns The cached distance, or `undefined` on a cache miss.
 */
export function getCachedDistance(
  uuidA: string,
  uuidB: string,
): number | undefined {
  const key = makeCacheKey(uuidA, uuidB);
  const distance = cache.get(key);
  if (distance !== undefined) {
    // Refresh recency: re-insert moves the key to the most-recently-used
    // (last) position, keeping eviction O(1).
    cache.delete(key);
    cache.set(key, distance);
    hits++;
    return distance;
  }
  misses++;
  return undefined;
}

/**
 * Store a computed distance for the given creature UUID pair.
 */
export function setCachedDistance(
  uuidA: string,
  uuidB: string,
  distance: number,
): void {
  const key = makeCacheKey(uuidA, uuidB);
  // Delete-then-set so an existing key moves to the most-recently-used position.
  cache.delete(key);
  cache.set(key, distance);
  evictIfNeeded();
}

/**
 * Clear the entire distance cache.
 * Useful between evolution runs or when the population is replaced.
 */
export function clearDistanceCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
  evictions = 0;
}

/**
 * Set the maximum number of entries the cache may hold.
 * Values below 1 are clamped to 1.
 */
export function setDistanceCacheMaxSize(max: number): void {
  maxSize = Math.max(1, Math.floor(max));
  evictIfNeeded();
}

/**
 * Return the current number of cached entries.
 */
export function getDistanceCacheSize(): number {
  return cache.size;
}

/**
 * Return cache hit/miss statistics for diagnostics.
 *
 * Issue #1616: Returns a full {@link CacheStats} object for unified
 * cache diagnostics.
 */
export function getDistanceCacheStats(): CacheStats {
  return {
    name: "Distance Cache",
    hits,
    misses,
    evictions,
    currentSize: cache.size,
    maxSize: maxSize,
  };
}

/**
 * Evict the least-recently-used entries until the cache is within bounds.
 *
 * Issue #3084: `Map` iterates in insertion order and both `getCachedDistance`
 * and `setCachedDistance` re-insert on access, so the first key is always the
 * least-recently-used entry. Removing it is O(1) — no full-cache scan.
 */
function evictIfNeeded(): void {
  while (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
    evictions++;
  }
}
