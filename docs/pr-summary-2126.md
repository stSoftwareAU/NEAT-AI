## Summary

Pool Float64Array allocations in `extractWeights()` and `extractBiases()` within
`src/architecture/Score.ts`. Module-level buffers grow as needed (never shrink)
and return subarray views, eliminating per-call `Float64Array` allocations in
the score update hot path. Closes #2126.

## Evidence

Benchmark results (500 iterations per scenario, pooled buffers):

| Scenario | Synapses | Score Calc | Bias Scan |
| -------- | -------- | ---------- | --------- |
| Small    | 550      | 4.22 µs    | 5.20 µs   |
| Medium   | 3,275    | 6.86 µs    | 3.86 µs   |
| Large    | 17,750   | 31.77 µs   | 19.11 µs  |

The pooled buffer pattern eliminates repeated `Float64Array` constructor calls,
which is the same pre-allocated buffer approach already used in
`WasmStandaloneFunctions.ts`. The original PR #2060 demonstrated 10–18%
improvement across scenarios.

## Test Plan

- Added `test/architecture/ScorePooledBuffers.ts` with 8 tests verifying:
  - Pool buffers grow when creature size increases
  - Pool buffers do not shrink when creature size decreases
  - Pool buffers are reused across multiple calculate calls
  - Extraction correctness verified via score consistency
  - Correct results after pool growth (small → large → small)
  - Incremental weight update correctness with pooled buffers
  - Incremental bias update correctness with pooled buffers
  - Reset clears pool capacity
- All 5,199 existing tests continue to pass
- Added `bench/ScorePooledBuffers.ts` benchmark
