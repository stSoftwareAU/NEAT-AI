## Summary

Fixed double learning rate application in weight and bias accumulation. Closes #1653.

The learning rate was being applied **twice** per update cycle:
1. During accumulation (`limitWeight`/`limitBias` in `accumulateWeight`/`accumulateBias`)
2. During calculation (`limitWeight`/`limitBias` in `calculateWeight`/`calculateBias`)

This caused the effective learning rate to be approximately `learningRate²` (e.g., with default `learningRate = 0.01`, the effective rate was `0.0001` — 100x slower than intended).

**Fix**: Removed `limitWeight`/`limitBias` calls from all accumulation functions (single, 4-way batch, 8-way batch), storing raw target values instead. The learning rate is now applied exactly once in the final calculation step. Applied consistently across both TypeScript and Rust WASM implementations.

## Evidence

This is a backend logic fix with no UI changes. Verified by:
- 8 new tests in `test/propagate/SingleLearningRateApplication.ts` that assert the effective learning rate matches the configured rate
- All 4331 existing tests pass (0 failures)
- 200 Rust WASM unit tests pass

## Test Plan

- Added `test/propagate/SingleLearningRateApplication.ts` with 8 tests:
  - `weight update applies learning rate exactly once (not squared)` — verifies with `learningRate=0.5`, delta produces `0.5 * delta` not `0.25 * delta`
  - `weight update with learningRate=1 passes through full delta`
  - `bias update applies learning rate exactly once (not squared)`
  - `bias update with learningRate=1 passes through full delta`
  - `effective weight change matches configured learning rate` — parametric test with `learningRate=0.3`
  - `effective bias change matches configured learning rate` — parametric test with `learningRate=0.3`
  - `multiple weight accumulations still apply learning rate once`
  - `weight change direction preserved with negative activations`
