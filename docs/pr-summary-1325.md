## Summary

Adds gradient-informed quantum adjustment to the memetic fine-tuning system
(#1325).

The current quantum adjustment in `FineTune.ts` uses uniform random scaling to
perturb weights and biases. This change adds an optional gradient hint mechanism
that leverages information from the elastic backpropagation system to inform the
direction and magnitude of adjustments.

### What changed

1. **New `GradientHint` type and `collectGradientHints()` function**
   (`src/blackbox/GradientHint.ts`):
   - `GradientHint` has `direction` (-1, 0, or 1) and `magnitude` (normalised
     0-1)
   - `collectGradientHints()` runs a single backprop pass on a cloned creature
     to extract what direction and how strongly backpropagation would adjust
     each bias and weight
   - Uses `calculateBias()` and `calculateWeight()` from the existing
     propagation system

2. **Extended `quantumAdjust()` function** (`src/blackbox/FineTune.ts`):
   - Added optional `gradientHint` parameter
   - When gradient direction opposes the random delta, probabilistically flips
     delta towards gradient (probability = gradient magnitude)
   - When gradient aligns with delta, amplifies it proportionally to magnitude
   - Fully backward compatible - existing callers unaffected

3. **Extended `tuneRandomize()` and `fineTuneImprovement()`**:
   - Accept optional `GradientHintMap` parameter
   - Pass per-parameter gradient hints through to each `quantumAdjust()` call

### Design decisions

- **Hybrid approach**: Gradient direction informs but doesn't dictate; random
  magnitude is preserved for exploration
- **Non-invasive**: All new parameters are optional; zero existing callers
  needed updating
- **Clone-based collection**: Gradient collection uses a cloned creature to
  avoid mutating the original
- **Normalised magnitude**: Uses `|diff| / (1 + |diff|)` for bounded [0, 1)
  normalisation

## Evidence

This is a backend/CLI enhancement with no visual output. All changes verified
through unit tests.

All 2055 existing tests continue to pass, confirming no regressions.

## Test Plan

### New test files

- `test/blackbox/GradientInformedQuantumAdjust.ts` (8 tests):
  - Gradient hint biases direction towards gradient sign (positive)
  - Gradient hint biases direction towards gradient sign (negative)
  - Zero direction has no directional bias
  - Zero magnitude has no effect
  - Backward compatible without gradient hint
  - Gradient hint combined with momentum
  - Gradient hint produces finite values
  - Gradient hint does not prevent changed=false when no diff

- `test/blackbox/GradientHint.ts` (5 tests):
  - Returns hints for biases and weights
  - Empty training data returns empty hints
  - Direction reflects gradient sign
  - Magnitude is normalised between 0 and 1
  - Works with multi-layer creature

### Existing tests verified

All 41 existing blackbox tests pass without modification, including:

- `test/blackbox/QuantumAdjust.ts` (7 tests)
- `test/blackbox/AdaptiveQuantumStep.ts` (11 tests)
- `test/blackbox/FineTune.ts` (2 tests)
- `test/blackbox/BiasWeightCoordination.ts` (13 tests)
- `test/blackbox/MemeticAncestry.ts` (8 tests)
