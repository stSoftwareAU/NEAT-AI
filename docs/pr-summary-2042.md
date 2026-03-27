## Summary

Eliminate array allocation from `neurons.slice(creature.input).findIndex()` in
`scanMaxForBiasChange()` and replace closure-based `synapses.findIndex()` in
`scanMaxForWeightChange()` with direct `for` loops. These scan functions are
called in the score update hot path when the maximum weight/bias changes and the
secondMax cache is stale. Closes #2042.

## Evidence

### Benchmark results (bench/ScoreScanAllocation.ts)

The benchmark forces the scan path by setting secondMax to stale and reducing
the max value, triggering `scanMaxForBiasChange`/`scanMaxForWeightChange` on
every iteration.

**Before (baseline — slice + findIndex):**

| Size                                  | Bias scan/iter | Weight scan/iter |
| ------------------------------------- | -------------- | ---------------- |
| Small (105 neurons, 2,750 synapses)   | ~41us          | ~37us            |
| Medium (255 neurons, 15,500 synapses) | ~168us         | ~203us           |
| Large (555 neurons, 53,750 synapses)  | ~707us         | ~742us           |

**After (direct for loops):**

| Size                                  | Bias scan/iter | Weight scan/iter |
| ------------------------------------- | -------------- | ---------------- |
| Small (105 neurons, 2,750 synapses)   | ~18us          | ~17us            |
| Medium (255 neurons, 15,500 synapses) | ~74us          | ~78us            |
| Large (555 neurons, 53,750 synapses)  | ~231us         | ~239us           |

Improvement ranges from ~50-67% across creature sizes in warm runs. The
improvement comes from eliminating:

1. The `neurons.slice()` intermediate array allocation (O(n) copy)
2. Closure creation overhead from `.findIndex()` callbacks

## Test Plan

- Added
  `updateScoreForBiasChange - scan path matches full recalculation when secondMax is stale`
  test that forces the bias scan path and verifies the incremental result
  matches a full recalculation
- Added
  `updateScoreForWeightChange - scan path matches full recalculation when secondMax is stale`
  test that forces the weight scan path and verifies correctness
- All 5,057 existing tests continue to pass
- Added `bench/ScoreScanAllocation.ts` benchmark for measuring scan function
  performance
