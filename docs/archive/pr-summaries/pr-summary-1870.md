## Summary

Add targeted test cases exercising backpropagation through chains of different
squash functions to identify corner cases where gradient flow degrades. Closes
#1870.

The test file `test/propagate/MixedSquashChains.ts` contains 11 tests covering:

- Multi-layer mixed squash convergence (bounded→bounded, unbounded→bounded,
  non-differentiable, all-saturating)
- Saturation chain behaviour (TANH saturated, GAUSSIAN peak, Exponential large
  derivatives)
- Gradient magnitude verification across multiple chain types
- Aggregate function chains (IF, MAXIMUM)
- Safe zone interaction with mixed upstream squash types

## Evidence

All 11 tests pass and verify convergence direction, finite outputs, and gradient
flow through the first hidden layer. The full quality gate passes with 4494
tests.

## Test Plan

- `test/propagate/MixedSquashChains.ts` — 11 new test cases:
  - Mixed chain: bounded→bounded (TANH → LOGISTIC → BIPOLAR_SIGMOID)
  - Mixed chain: unbounded→bounded (ReLU → TANH → LOGISTIC)
  - Mixed chain: non-differentiable mixed (STEP → ReLU → TANH)
  - Mixed chain: all saturating (LOGISTIC → TANH → LOGISTIC) in saturation zones
  - Saturation: TANH(saturated) → LOGISTIC near boundary
  - Saturation: GAUSSIAN(peak) → SELU gradient flow
  - Saturation: Exponential(large) → TANH bounded containment
  - Gradient magnitude: error at first hidden layer is non-trivial and finite
  - Aggregate mixed: IF → TANH → output convergence
  - Aggregate mixed: MAXIMUM → LOGISTIC convergence
  - Safe zone: mixed squash types compose correctly through connections
