## Summary

Fixed double learning rate application in weight and bias accumulation.
The learning rate was applied twice per update cycle — once during accumulation
(`accumulateWeight`/`accumulateBias`) and again during calculation
(`calculateWeight`/`calculateBias`) — resulting in an effective rate of
`learningRate²` instead of `learningRate`. With the default rate of 0.01,
the effective rate was 0.0001 (100x slower than intended).

The fix removes the `limitWeight`/`limitBias` calls from all accumulation
functions (single, batch-4, batch-8) in both TypeScript and Rust/WASM,
so that raw target values are accumulated and limiting is applied exactly
once during the calculation step.

Closes #1653.

## Evidence

This is a logic fix with no UI changes. The fix is verified by unit tests
that assert the effective weight/bias change matches `learningRate * delta`
(single application) rather than `learningRate² * delta` (double application).

All 4329 tests pass after the fix, including convergence tests (e.g. XNOR evolve).

## Test Plan

- Added `test/propagate/DoubleLearningRate.ts` with 6 tests:
  - Weight update applies learning rate exactly once
  - Weight batch4 accumulates raw values (no double limiting)
  - Weight batch8 accumulates raw values (no double limiting)
  - Bias update applies learning rate exactly once
  - Bias batch4 accumulates raw values (no double limiting)
  - Bias batch8 accumulates raw values (no double limiting)
- All existing tests (4329) continue to pass
