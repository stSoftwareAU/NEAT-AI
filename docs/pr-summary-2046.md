## Summary

Pool Float64Array allocations in `extractWeights()` and `extractBiases()` helper
functions in `src/architecture/Score.ts`. These functions previously allocated
new `Float64Array` instances on every call in the score update hot path. Now
they use module-level pooled buffers that grow as needed (never shrink) and
return subarray views, following the proven pre-allocated buffer pattern from
`WasmStandaloneFunctions.ts`. Closes #2046.

## Evidence

### Benchmark Results (500 iterations per scenario)

| Scenario                 | Metric     | Before         | After          | Change     |
| ------------------------ | ---------- | -------------- | -------------- | ---------- |
| Small (2,750 synapses)   | Score calc | 8.71 us/iter   | 7.88 us/iter   | **-9.5%**  |
| Medium (15,500 synapses) | Score calc | 36.49 us/iter  | 31.99 us/iter  | **-12.3%** |
| Large (53,750 synapses)  | Score calc | 123.51 us/iter | 103.34 us/iter | **-16.3%** |
| Small                    | Bias scan  | 14.07 us/iter  | 11.49 us/iter  | **-18.3%** |
| Medium                   | Bias scan  | 68.49 us/iter  | 58.28 us/iter  | **-14.9%** |

The score calculation hot path shows consistent 10-16% improvement, with larger
creatures benefiting more from reduced allocation pressure.

## Test Plan

- Added `test/score/ScoreExtractionPool.ts` with 4 tests verifying:
  - Varying creature sizes produce consistent scores (pool growth)
  - Smaller creature after larger still produces correct results (pool reuse)
  - Incremental weight update correct after pool reuse (scan path)
  - Incremental bias update correct after pool reuse (scan path)
- All 27 existing Score.ts tests continue to pass
- All 5061 repository tests pass
- Added `bench/ScoreExtractionPool.ts` benchmark for reproduction
