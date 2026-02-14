## Summary

Add comprehensive behavioural tests for the backpropagation training pipeline. Closes #1440.

Seven new test files covering all modules identified in the issue:

- **WeightConvergence.ts** (7 tests): Weight convergence over multiple accumulate/calculate cycles, batch boundary recalculation via `adjustedWeight`, disableWeightAdjustment flag, and generation blending dampening
- **BiasConvergence.ts** (8 tests): Bias convergence, batch boundary behaviour via `adjustedBias`, disableBiasAdjustment flag, constant neuron handling, noChange flag, and generation blending dampening
- **ElasticDistributionBehaviour.ts** (16 tests): Error conservation (shares sum to original error for positive, negative, and multi-link cases), proportional distribution based on activation², safe-zone factor effects, weight-based fallback, equal-split fallback, and non-finite edge cases
- **BackPropagationConfigBehaviour.ts** (18 tests): Config defaults, learning rate bounds [0.001, 1], adjustment scale bounds, training mutation rate bounds, initial learning rate and decay clamping, strategy selection, decay monotonicity, and adaptive learning rate responses to improving/stagnant/worsening error
- **ActivationRangeBehaviour.ts** (19 tests): Range construction and validation, boundary acceptance/rejection, NaN/Infinity rejection, limit clamping, and squash-specific range behaviour (ReLU, sigmoid, tanh patterns)
- **ErrorHelperBehaviour.ts** (10 tests): Sign preservation, custom maxMagnitude values, non-finite handling, zero/fractional error edge cases
- **RecordElasticityBehaviour.ts** (14 tests): Weight-squared proportional distribution, error conservation, combined safeZoneFactor × feasibilityFactor gating, per-squash feasibility (SQUARE, SELU, GELU, ELU, ReLU, IDENTITY), and constrained redistribution with range-limited squashes

## Evidence

This is a purely test-only change with no UI components. All 3228 tests pass (0 failures) after adding the new test files.

## Test Plan

- `test/propagate/WeightConvergence.ts` — 7 new tests
- `test/propagate/BiasConvergence.ts` — 8 new tests
- `test/propagate/ElasticDistributionBehaviour.ts` — 16 new tests
- `test/propagate/BackPropagationConfigBehaviour.ts` — 18 new tests
- `test/propagate/ActivationRangeBehaviour.ts` — 19 new tests
- `test/propagate/ErrorHelperBehaviour.ts` — 10 new tests
- `test/propagate/RecordElasticityBehaviour.ts` — 14 new tests

Total: **92 new behavioural tests** across 7 files
