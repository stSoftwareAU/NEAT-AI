# PR Summary for Issue #1207

## Summary

This PR addresses issue #1207, which asked whether there are opportunities for
SIMD parallelism improvements similar to the 31% speedup achieved in PR #1205
(WASM mini-batching for forward-only networks).

After a thorough analysis of the codebase, **6 new GitHub issues** were created
documenting specific opportunities for SIMD/parallelism improvements:

| Issue                                                        | Title                                        | Priority | Est. Speedup |
| ------------------------------------------------------------ | -------------------------------------------- | -------- | ------------ |
| [#1209](https://github.com/stSoftwareAU/NEAT-AI/issues/1209) | 8-record SIMD mini-batching                  | HIGH     | 50-70%       |
| [#1210](https://github.com/stSoftwareAU/NEAT-AI/issues/1210) | 4-way batching for MAE/MAPE/MSLE/Hinge       | MEDIUM   | 31%          |
| [#1211](https://github.com/stSoftwareAU/NEAT-AI/issues/1211) | Vectorise squash function application        | MEDIUM   | 10-20%       |
| [#1212](https://github.com/stSoftwareAU/NEAT-AI/issues/1212) | Batch activate_and_trace for backpropagation | HIGH     | 4x           |
| [#1213](https://github.com/stSoftwareAU/NEAT-AI/issues/1213) | Batch derivative computation                 | HIGH     | 4x           |
| [#1214](https://github.com/stSoftwareAU/NEAT-AI/issues/1214) | Batch weight/bias gradient accumulation      | MEDIUM   | 4x           |

## Analysis Performed

The following areas were analysed for SIMD parallelism opportunities:

1. **WASM activation module** (`wasm_activation/src/lib.rs`)
   - Current 4-record SIMD batching in `mse_sum_batch_4way()`
   - Loss functions without batching (MAE, MAPE, MSLE, Hinge)
   - Scalar squash function application
   - Single-record `activate_and_trace()`

2. **Backpropagation code** (`src/propagate/`)
   - Weight accumulation (`Weight.ts`)
   - Bias adjustment (`Bias.ts`)
   - Derivative computation

3. **Training loops**
   - Mini-batch processing (default `batchSize: 64`)
   - Gradient accumulation patterns

## Key Findings

### What PR #1205 Did Well

- Used SIMD across records (4 records at a time for 1 synapse) instead of SIMD
  across synapses
- Leveraged FMA (fused multiply-add) via relaxed-simd
- Achieved 31% speedup for forward-only networks with standard squash functions

### New Opportunities Identified

1. **8-record batching** (#1209): Extend the 4-record approach to 8 records by
   stacking two v128 operations. This could achieve 50-70% speedup over the
   current 4-record implementation.

2. **Loss function batching** (#1210): MAE, MAPE, MSLE, and Hinge loss functions
   still use single-record processing. Implementing 4-way batching would provide
   consistent 31% speedup.

3. **Vectorised squash functions** (#1211): Currently squash functions are
   applied sequentially to 4 values. Vectorising common functions (ReLU,
   Logistic, Tanh) could provide 10-20% improvement.

4. **Backpropagation batching** (#1212, #1213, #1214): The training pipeline
   processes records one at a time. Batching activation tracing, derivative
   computation, and gradient accumulation could provide 4x speedups.

## Evidence

This is a research/planning issue - no code changes were made. Evidence consists
of the created GitHub issues with detailed proposals and implementation notes.

### Issues Created

- https://github.com/stSoftwareAU/NEAT-AI/issues/1209
- https://github.com/stSoftwareAU/NEAT-AI/issues/1210
- https://github.com/stSoftwareAU/NEAT-AI/issues/1211
- https://github.com/stSoftwareAU/NEAT-AI/issues/1212
- https://github.com/stSoftwareAU/NEAT-AI/issues/1213
- https://github.com/stSoftwareAU/NEAT-AI/issues/1214

## Test Plan

No code changes were made, so no new tests were required.

Quality checks passed:

```
ok | 1785 passed (2 steps) | 0 failed | 1 ignored (29s)
```

## Recommended Implementation Order

1. **#1209 (8-record SIMD)**: Highest potential impact with established pattern
2. **#1212 (activate_and_trace)**: Enables backpropagation batching
3. **#1213 (Derivative SIMD)**: Unlocks backpropagation performance
4. **#1210 (Loss function batching)**: Consistent pattern, proven methodology
5. **#1211 (Squash function SIMD)**: Fine-grained optimisations
6. **#1214 (Gradient accumulation)**: Completes training pipeline optimisation
