/**
 * Benchmark for the DistanceCache LRU eviction write path.
 *
 * Issue #3084: The breed `DistanceCache` previously found the
 * least-recently-used entry by scanning the entire cache on every eviction,
 * making writes O(cacheSize) once the cache is full. Speciation is an O(N²)
 * all-pairs pass, so a saturated cache turned every insert into a full scan.
 *
 * This benchmark drives the write path well past `maxSize` so that nearly every
 * insert triggers an eviction, isolating the eviction cost that the O(1)
 * insertion-order LRU removes.
 *
 * Run with:
 *   deno bench --allow-read --allow-write bench/DistanceCacheEviction.ts
 */
import {
  clearDistanceCache,
  setCachedDistance,
  setDistanceCacheMaxSize,
} from "@breed/DistanceCache.ts";

// A small cache that saturates quickly so eviction dominates the write path.
const MAX_SIZE = 2_000;
// Far more distinct keys than the cache can hold, so most inserts evict.
const INSERTS = 40_000;

// Pre-compute the keys so key construction does not pollute the measurement.
const keysA: string[] = [];
const keysB: string[] = [];
for (let i = 0; i < INSERTS; i++) {
  keysA.push(`creature-uuid-${i}`);
  keysB.push(`creature-uuid-${i + INSERTS}`);
}

Deno.bench({
  name:
    `Eviction-heavy writes: ${INSERTS} inserts into a ${MAX_SIZE}-entry cache`,
  fn() {
    clearDistanceCache();
    setDistanceCacheMaxSize(MAX_SIZE);
    for (let i = 0; i < INSERTS; i++) {
      setCachedDistance(keysA[i], keysB[i], i * 0.001);
    }
    setDistanceCacheMaxSize(10_000);
    clearDistanceCache();
  },
});
