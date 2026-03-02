## Summary

Fixed double learning rate application in weight and bias accumulation. The learning rate was applied twice per update cycle — once during accumulation (`accumulateWeight`/`accumulateBias` via `limitWeight`/`limitBias`) and again during calculation (`calculateWeight`/`calculateBias` via `limitWeight`/`limitBias`). This caused the effective learning rate to be approximately `learningRate²` (e.g., `0.0001` instead of `0.01`), making convergence 100× slower than intended.

The fix removes `limitWeight`/`limitBias` calls from all accumulation functions (single, 4-way batch, and 8-way batch) in both TypeScript and Rust/WASM, so that raw target values are accumulated and the learning rate is applied exactly once during the final calculation step.

Closes #1653.

## Evidence

This is a backend logic fix with no UI changes. The fix is verified by 6 new tests that confirm the learning rate is applied exactly once:

- With `learningRate = 0.5` and a target weight delta of 2.0, the expected result is `currentWeight + 0.5 * delta = 2.0`
- Before the fix: result was 1.5 (learning rate applied twice: `0.5 * 0.5 * delta`)
- After the fix: result is 2.0 (learning rate applied once: `0.5 * delta`)

All 4334 existing tests continue to pass, including convergence tests.

## Test Plan

- Added `test/propagate/SingleLearningRateApplication.ts` with 6 tests:
  - `Issue #1653 - weight update applies learning rate exactly once`
  - `Issue #1653 - weight batch 4-way applies learning rate exactly once`
  - `Issue #1653 - weight batch 8-way applies learning rate exactly once`
  - `Issue #1653 - bias update applies learning rate exactly once`
  - `Issue #1653 - bias batch 4-way applies learning rate exactly once`
  - `Issue #1653 - bias batch 8-way applies learning rate exactly once`
