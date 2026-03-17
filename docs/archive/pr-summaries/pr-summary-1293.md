## Summary

Implements incremental species distance calculation by caching pairwise genetic
compatibility distances between creatures (#1293).

The `DistanceCache` stores computed compatibility scores keyed by creature UUID
pairs. Since creature UUIDs are deterministic hashes of structure, a cached
distance remains valid as long as neither creature's structure has changed
(which would produce a new UUID). The cache uses canonical key ordering so that
`distance(A, B)` and `distance(B, A)` share a single entry.

### Changes

- **New file: `src/breed/DistanceCache.ts`** - LRU cache with configurable max
  size (default 10,000 entries), hit/miss statistics, and canonical key ordering
- **Modified: `src/breed/GeneticCompatibility.ts`** - Integrated distance cache
  lookup before computation and storage after computation. Creatures without
  UUIDs bypass the cache gracefully.
- **New file: `test/breed/DistanceCache.ts`** - 10 unit tests covering cache
  storage, retrieval, canonical ordering, LRU eviction, statistics, cache
  integration with `geneticCompatibility`, and edge cases.
- **New file: `bench/IncrementalDistanceCache.ts`** - Benchmark comparing cold
  cache, warm cache, and repeated computation scenarios.

## Evidence

### Benchmark Results

| Scenario                                | Without Cache | With Cache (warm) | Improvement      |
| --------------------------------------- | ------------- | ----------------- | ---------------- |
| All pairwise (50 creatures, 1225 pairs) | 984 µs        | 126 µs            | **7.8x faster**  |
| 3 generations repeated pairwise         | 3.0 ms        | 382 µs            | **7.9x faster**  |
| Single pair repeated 100 times          | 83.6 µs       | 6.3 µs            | **13.3x faster** |

Cold cache (first computation) adds ~40% overhead for Map operations, but this
is amortised immediately on the next comparison of the same pair.

**Cache hit rate**: 100% for unchanged populations across generations. In
practice, the hit rate depends on the fraction of the population that mutates
each generation.

**Memory overhead**: Each cache entry is ~100 bytes (two UUID strings + distance
float + access counter). At the default max of 10,000 entries, this is ~1 MB.

## Test Plan

- `test/breed/DistanceCache.ts` (10 tests):
  - Stores and retrieves distances correctly
  - Canonical key order: `(a,b) == (b,a)`
  - Returns undefined on cache miss
  - `clearDistanceCache` removes all entries
  - LRU eviction when exceeding max size
  - Statistics track hits and misses
  - `geneticCompatibility` uses cache for same pair
  - Consistent results with and without cache
  - Creatures without UUIDs bypass cache
  - Shared neurons produce correct cached compatibility
- All 4 existing `GeneticCompatibility` tests pass unchanged
- All 6 existing `HiddenNeuronUUIDCache` tests pass unchanged
- All 7 existing `ParallelBreeding` tests pass unchanged
- Full quality.sh: 2165 passed, 1 pre-existing flaky failure unrelated to
  changes
