## Summary

Investigated migrating genetic compatibility scoring to Rust/WASM (part of
#1629). Benchmarks confirm the existing TypeScript implementation with LRU
distance cache is already highly optimised — WASM migration would not provide
meaningful improvement. Closes #1633.

**Decision: No WASM migration needed.** This is a documented negative result.

## Benchmark Results

### Set Intersection Performance (500-neuron creatures)

| Benchmark                                | Time/iter | Iter/s  |
| ---------------------------------------- | --------- | ------- |
| Original: spread + filter intersection   | 5.3 µs    | 188,500 |
| Optimised: direct iteration intersection | 2.0 µs    | 492,300 |
| Full geneticCompatibility (50% overlap)  | 1.9 µs    | 527,000 |
| Full geneticCompatibility (no overlap)   | 2.0 µs    | 504,200 |

### Distance Cache Hit Rate Analysis (50-creature population)

| Scenario                              | Hits  | Misses | Hit Rate |
| ------------------------------------- | ----- | ------ | -------- |
| Round 1: Cold cache (first pass)      | 0     | 1,225  | 0.0%     |
| Round 2: Warm cache (same population) | 1,225 | 0      | 100.0%   |
| Round 3: 20% population replaced      | 780   | 445    | 63.7%    |

### Cache Hit vs Miss Performance

| Benchmark                                      | Time/iter | Speedup      |
| ---------------------------------------------- | --------- | ------------ |
| Cache hit                                      | 66.3 ns   | baseline     |
| Cache miss                                     | 521.2 ns  | 7.86x slower |
| Full pairwise (warm, 50 creatures, 1225 pairs) | 118.9 µs  | ~97 ns/pair  |

### Why WASM Migration Would Not Help

1. **Cache hit path is 66 ns** — far below the overhead of any JS↔WASM boundary
   crossing (~100–500 ns for argument marshalling alone).
2. **Cache hit rate is high**: 100% for stable populations, 63.7% even with 20%
   turnover per generation. In real evolution runs, populations change
   gradually, keeping hit rates high.
3. **Even cache misses are fast**: At 521 ns per miss (including Set
   intersection over 100-neuron sets), the computation is already
   sub-microsecond.
4. **Batch WASM computation would not help**: The cache already eliminates
   redundant work. A batch WASM call processing all pairs would lose the cache
   benefit and need to recompute distances that are already cached.

## Evidence

This is a backend performance investigation with no UI changes. Evidence is
provided via benchmark output above. The benchmark script
`bench/DistanceCacheHitRate.ts` can be re-run to reproduce:

```bash
deno bench --allow-read --allow-write --allow-env --allow-ffi bench/DistanceCacheHitRate.ts
```

## Test Plan

- Added `bench/DistanceCacheHitRate.ts` — new benchmark measuring cache hit/miss
  rates during simulated speciation with pairwise compatibility checks
- Existing benchmarks verified: `bench/GeneticCompatibilitySetIntersection.ts`
  and `bench/FatherCompatibility.ts` both pass and confirm baseline performance
