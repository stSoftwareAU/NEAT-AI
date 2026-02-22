## Summary

Implements rejection sampling for `AddConnection.mutate()` to avoid building
the full O(N²) available-connections list on every mutation call. For sparse
networks (the common case), the new approach randomly picks `(from, to)` pairs
and checks connection existence in O(1) via `hasConnection()`. Falls back to
the full-scan approach after 20 failed attempts (dense networks) or when
focusList/mutationBias requires weighted selection over all candidates.
Closes #1587.

## Changes

- `src/mutate/AddConnection.ts`: Refactored `mutate()` into two paths:
  - `tryRejectionSampling()` — picks random forward-ordered neuron pairs,
    validates via O(1) `hasConnection()` lookup, accepts on first valid pair
  - `fullScanMutate()` — original O(N²) full-list approach, used as fallback
    and when focusList or mutationBias is active
- `bench/mutate/AddConnectionRejectionSampling.ts`: Benchmark for
  before/after comparison

## Evidence

Benchmark results (`deno bench bench/mutate/AddConnectionRejectionSampling.ts`)
on Apple M4 Pro. Note: each iteration includes creature construction, so the
`mutate()` speedup is diluted by construction overhead.

| Creature Size | Neurons | Baseline (avg) | Rejection Sampling (avg) | Improvement |
| ------------- | ------- | -------------- | ------------------------ | ----------- |
| Sparse        | 13      | 125.9 us       | 110.4 us                 | **12%**     |
| Medium        | 30      | 589.8 us       | 537.6 us                 | **9%**      |
| Large         | 60      | 2.3 ms         | 2.1 ms                   | **9%**      |
| Very Large    | 150     | 14.6 ms        | 13.2 ms                  | **10%**     |

The improvement is consistent across all sizes. The actual `mutate()` speedup
is significantly larger than shown because creature construction dominates
the benchmark time. For sparse networks (the typical NEAT scenario), rejection
sampling finds a valid pair in 1-2 attempts, completely avoiding the O(N²)
available-connections list construction and cache population.

## Test Plan

- All 4361 existing tests pass with no modifications
- The rejection sampling path is exercised by existing AddConnection tests
  (which don't use focusList or mutationBias)
- The `AvailableConnectionsCache` test validates that connection counts remain
  consistent after multiple mutations
- Added benchmark for before/after performance comparison
