## Summary

Reduce allocations in ModWeight mutation focus filtering by replacing the
triple-allocation pattern (Set<Synapse> → Array.from → .filter) with a
single-pass approach that builds the result array directly. Deduplication
uses a Set<number> keyed by synapse identity, and frozen-status checking
is done inline. This eliminates 2 intermediate allocations per mutation
call. Closes #2124.

## Evidence

Benchmark results (Apple M4, Deno 2.7.10):

| Benchmark | Old (ns/iter) | New (ns/iter) | Improvement |
|-----------|--------------|--------------|-------------|
| Small creature (5 hidden, 3 focus) | 259.7 | 255.5 | ~1.6% |
| Medium creature (20 hidden, 6 focus) | 812.0 | 751.1 | ~7.5% |

The primary benefit is reduced GC pressure from eliminating short-lived
intermediate arrays over thousands of mutations per generation.

## Test Plan

- Added `test/mutate/ModWeightFocusFiltering.ts` with 3 new tests:
  - Frozen synapses excluded from focus filtering
  - Deduplication when focus neurons share synapses (statistical verification)
  - Frozen synapses excluded even with shared focus neurons
- All 5187 existing tests pass (`./quality.sh`)
- Benchmark at `bench/mutate/ModWeightFocusFiltering.ts`
