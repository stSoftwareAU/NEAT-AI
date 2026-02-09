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

const DEFAULT_MAX_SIZE = 10_000;

/** Cached distance entry with access tracking for LRU eviction. */
interface DistanceEntry {
  distance: number;
  lastAccess: number;
}

/**
 * Make a canonical cache key from two UUIDs.
 * Sorting ensures (a, b) and (b, a) map to the same key.
 */
function makeCacheKey(uuidA: string, uuidB: string): string {
  return uuidA < uuidB ? `${uuidA}\0${uuidB}` : `${uuidB}\0${uuidA}`;
}

/** Global distance cache instance. */
const cache = new Map<string, DistanceEntry>();
let maxSize = DEFAULT_MAX_SIZE;
let accessCounter = 0;

// Counters for diagnostics / benchmarking
let hits = 0;
let misses = 0;

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
  const entry = cache.get(key);
  if (entry !== undefined) {
    entry.lastAccess = ++accessCounter;
    hits++;
    return entry.distance;
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
  cache.set(key, { distance, lastAccess: ++accessCounter });
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
  accessCounter = 0;
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
 * Get the current maximum cache size.
 */
export function getDistanceCacheMaxSize(): number {
  return maxSize;
}

/**
 * Return the current number of cached entries.
 */
export function getDistanceCacheSize(): number {
  return cache.size;
}

/**
 * Return cache hit/miss statistics for diagnostics.
 */
export function getDistanceCacheStats(): {
  hits: number;
  misses: number;
  size: number;
} {
  return { hits, misses, size: cache.size };
}

/**
 * Evict the oldest entries until the cache is within bounds.
 */
function evictIfNeeded(): void {
  while (cache.size > maxSize) {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey === null) break;
    cache.delete(oldestKey);
  }
}
