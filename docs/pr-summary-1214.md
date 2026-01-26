## Summary

Implements batch weight and bias gradient accumulation functions for issue #1214. This adds 4-way and 8-way batch processing functions that can process multiple synapses or neurons in a single call during backpropagation.

### Changes

1. **`src/propagate/Weight.ts`**: Added `accumulateWeightBatch4Way` and `accumulateWeightBatch8Way` functions that process 4 or 8 synapses simultaneously during weight gradient accumulation.

2. **`src/propagate/Bias.ts`**: Added `accumulateBiasBatch4Way` and `accumulateBiasBatch8Way` functions that process 4 or 8 neurons simultaneously during bias gradient accumulation.

3. **Test coverage**: Added comprehensive test suites in `test/propagate/AccumulateWeightBatch.ts` and `test/propagate/AccumulateBiasBatch.ts` verifying that batch functions produce identical results to calling the single-item functions repeatedly.

4. **Benchmark**: Added `bench/BatchGradientAccumulation.ts` to measure performance characteristics.

### Implementation Notes

The batch functions are designed as API building blocks for scenarios where callers already have data organised in arrays. The functions use a loop-based implementation that matches the exact semantics of the single-call versions, ensuring:

- Identical tracking of positive/negative activations
- Same weight/bias limiting behaviour
- Correct count increments
- Consistent handling of small values below the plank constant threshold

### Evidence (Benchmark Results)

```
    CPU | Apple M4 Pro
Runtime | Deno 2.6.4 (aarch64-apple-darwin)

group weight-accumulation
| Weight: Single calls (baseline)         |         31.0 µs |        32,220 |
| Weight: 4-way batch (reusable arrays)   |         39.3 µs |        25,420 |
| Weight: 8-way batch (reusable arrays)   |         37.5 µs |        26,650 |

group bias-accumulation
| Bias: Single calls (baseline)           |         32.6 µs |        30,690 |
| Bias: 4-way batch (reusable arrays)     |         37.7 µs |        26,510 |
| Bias: 8-way batch (reusable arrays)     |         35.5 µs |        28,210 |
```

**Note**: The current TypeScript implementation does not show a performance improvement over single calls due to:
1. The complex conditional logic in weight accumulation (tracking positive/negative activations separately)
2. Array creation overhead in the benchmark's usage pattern
3. V8's JIT compiler already optimises the single-call loop effectively

The batch functions provide API consistency with the existing WASM 4-way and 8-way forward pass functions and serve as building blocks for future WASM SIMD-based backpropagation optimisations where the conditional logic can be vectorised at the SIMD level.

### Future Work

For significant performance gains, the batch accumulation functions would need to be implemented in WASM using SIMD intrinsics (similar to the existing `weighted_sum_simd_4records` and `weighted_sum_simd_8records` functions in `wasm_activation/src/lib.rs`). This would allow the weight limiting and activation tracking to be done using vectorised operations without JavaScript object overhead.

## Test Plan

- Added 9 tests in `test/propagate/AccumulateWeightBatch.ts`:
  - `AccumulateWeightBatch4Way-MatchesSingleCalls`
  - `AccumulateWeightBatch4Way-AllPositiveActivations`
  - `AccumulateWeightBatch4Way-AllNegativeActivations`
  - `AccumulateWeightBatch4Way-MixedActivations`
  - `AccumulateWeightBatch4Way-MultipleIterations`
  - `AccumulateWeightBatch8Way-MatchesSingleCalls`
  - `AccumulateWeightBatch8Way-MultipleIterations`
  - `AccumulateWeightBatch4Way-TinyActivations`
  - `AccumulateWeightBatch4Way-WeightLimiting`

- Added 9 tests in `test/propagate/AccumulateBiasBatch.ts`:
  - `AccumulateBiasBatch4Way-MatchesSingleCalls`
  - `AccumulateBiasBatch4Way-PositiveDeltas`
  - `AccumulateBiasBatch4Way-NegativeDeltas`
  - `AccumulateBiasBatch4Way-MixedDeltas`
  - `AccumulateBiasBatch4Way-MultipleIterations`
  - `AccumulateBiasBatch8Way-MatchesSingleCalls`
  - `AccumulateBiasBatch8Way-MultipleIterations`
  - `AccumulateBiasBatch4Way-BiasLimiting`
  - `AccumulateBiasBatch4Way-ZeroDeltas`

All tests verify that batch functions produce results identical to calling the single-item functions iteratively, ensuring correctness of the implementation.
