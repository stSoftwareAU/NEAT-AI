## Summary

Replace `.slice().findIndex()` and `.findIndex()` with direct `for` loops in
`Score.ts` scan functions to eliminate intermediate array allocation and closure
creation overhead on the hot path. Closes #2122.

### Changes

1. **`scanMaxForBiasChange()`**: Replaced
   `neurons.slice(creature.input).findIndex(...)` with a direct `for` loop
   starting at `creature.input`. Eliminates O(n) array allocation on every call.

2. **`scanMaxForWeightChange()`**: Replaced `synapses.findIndex(...)` with a
   direct `for` loop. Eliminates closure creation overhead.

## Evidence

### Pattern isolation benchmarks (Apple M4, Deno 2.7.10)

**`slice().findIndex()` → direct `for` loop (bias scan index finding):**

| Size         | Before (slice+findIndex) | After (for loop) | Improvement |
| ------------ | ------------------------ | ---------------- | ----------- |
| Small (105)  | 68.9 ns                  | 54.1 ns          | **21%**     |
| Medium (255) | 164.5 ns                 | 133.9 ns         | **19%**     |
| Large (555)  | 371.6 ns                 | 295.9 ns         | **20%**     |

The `.slice()` allocation is the primary cost — `findIndex()` alone for weight
scanning shows comparable performance to a direct `for` loop due to V8 closure
optimisation, but the `.slice()` in the bias scan path allocates a new array on
every call.

End-to-end benchmarks show minimal wall-clock difference because the WASM scan
dominates execution time. The improvement reduces GC pressure from the
eliminated array allocation.

## Test Plan

- Added `test/architecture/ScoreScanCorrectness.ts` with 5 tests verifying:
  - `scanMaxForWeightChange` full scan produces correct results
  - `scanMaxForBiasChange` full scan produces correct results
  - Sequential weight updates remain correct through scan path
  - Sequential bias updates remain correct through scan path
  - Bias scan correctly skips input neurons
- All 5181 existing tests pass (`./quality.sh`)
- Benchmark: `bench/ScoreScanElimination.ts`
