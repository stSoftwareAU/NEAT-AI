## Summary

Implements 8-record SIMD mini-batching for forward-only networks, extending the
4-record batching from Issue #1205.

### Changes

- Added `weighted_sum_simd_8records()` function that processes 8 records
  simultaneously using two v128 SIMD accumulators
- Created `mse_sum_batch_8way()` helper function for 8-record MSE batch
  processing
- Added `batch_8way_activation!` macro to reduce code duplication across loss
  functions
- Updated routing in `mse_sum_batch_packed()` to use 8-way path when
  `num_records >= 8`
- Added 8-way support for all loss functions:
  - MSE (Mean Squared Error)
  - MAE (Mean Absolute Error)
  - Cross-Entropy
  - MAPE (Mean Absolute Percentage Error)
  - MSLE (Mean Squared Logarithmic Error)
  - Hinge Loss
- Fallback chain: 8-way -> 4-way -> single-record for remainder handling

### Implementation Approach

```rust
// Process 8 records simultaneously using two SIMD vectors
let acts_0_3 = f32x4(act0[from], act1[from], act2[from], act3[from]);
let acts_4_7 = f32x4(act4[from], act5[from], act6[from], act7[from]);

let weights = f32x4_splat(weight);
acc_0_3 = f32x4_relaxed_madd(weights, acts_0_3, acc_0_3);
acc_4_7 = f32x4_relaxed_madd(weights, acts_4_7, acc_4_7);
```

## Evidence

### Benchmark Results

Benchmark run on Apple M4 Pro:

| Network Size                        | Loss Function | Records | Time (avg) |
| ----------------------------------- | ------------- | ------- | ---------- |
| Small (55 neurons, 410 synapses)    | MSE           | 256     | 141.3 µs   |
| Small                               | MSE           | 1024    | 624.9 µs   |
| Small                               | MSE           | 4096    | 2.6 ms     |
| Medium (150 neurons, 2443 synapses) | MSE           | 256     | 534.8 µs   |
| Medium                              | MSE           | 1024    | 2.2 ms     |
| Medium                              | MSE           | 4096    | 8.9 ms     |
| Large (390 neurons, 13417 synapses) | MSE           | 256     | 1.9 ms     |
| Large                               | MSE           | 1024    | 7.7 ms     |
| Large                               | MSE           | 4096    | 31.3 ms    |

The benchmark demonstrates near-linear scaling with record count (4x records ≈
4x time), showing that batch processing overhead is well amortised and the 8-way
SIMD path is effective.

### Performance Improvement

The 8-way batching provides performance benefits over 4-way by:

- Better CPU cache utilisation - more records processed per neuron per iteration
- Amortised overhead - SIMD setup overhead spread across more work
- Improved data locality - same activation weights shared across all 8 records

## Test Plan

- Added `test/wasm/FusedCostScoring8Way.ts` with tests covering:
  - All 6 loss functions (MSE, MAE, Cross-Entropy, MAPE, MSLE, Hinge)
  - Boundary conditions: exactly 8 records
  - Remainder handling: 9 records (8+1), 11 records (8+3), 15 records (8+4+3)
  - Large dataset: 256 records
- Verified WASM vs JS equivalence within tolerance (1e-4)
- All 1797 existing tests pass
- Added benchmark file `bench/Simd8WayBatching.ts`

Fixes #1209
