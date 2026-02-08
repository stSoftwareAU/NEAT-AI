## Summary

Implements gradient-informed quantum adjustment for memetic fine-tuning (#1325).

The quantum adjustment in `FineTune.ts` previously used purely random scaling to
explore parameter space. This change adds optional gradient hints that bias the
direction of quantum adjustments based on the direction of parameter changes
that led to score improvement. This is a hybrid approach: gradient-informed
direction combined with random magnitude, preserving exploration while adding
guidance.

### Key changes:

- **New `GradientHint` interface** (`src/blackbox/GradientHint.ts`): Represents
  gradient direction (+1/-1/0) and normalised magnitude (0-1) for a single
  parameter
- **`applyGradientBias()` function**: Biases a random delta towards the gradient
  direction. When aligned, boosts magnitude by up to 50%. When opposing,
  probabilistically flips the delta (up to 70% chance based on gradient
  magnitude)
- **`computeGradientHint()` function**: Derives gradient hints from the
  difference between current and previous parameter values plus score
  improvement. Magnitude is normalised using `|x| / (1 + |x|)` (same formula as
  `calculateEffectiveStep`)
- **`quantumAdjust()` extended**: Accepts an optional `gradientHint` parameter
  applied after random delta generation but before momentum
- **`tuneRandomize()` integration**: Automatically computes gradient hints for
  each bias and weight during fine-tuning when score improvement is available

### Design decisions:

- Gradient hints are computed from parameter change direction + score
  improvement (no full backpropagation pass required)
- The gradient bias is applied before momentum, allowing both systems to
  contribute independently
- Zero magnitude or zero direction gradient hints have no effect (backward
  compatible)
- All existing tests pass unchanged — the feature is purely additive

## Evidence

This is a backend/algorithmic change with no visual output. Evidence is provided
through comprehensive unit tests that verify:

1. `applyGradientBias` correctly handles all edge cases (zero direction, zero
   magnitude, aligned deltas, opposing deltas, flip probability)
2. `computeGradientHint` correctly derives direction and magnitude from
   parameter changes
3. `quantumAdjust` accepts and uses gradient hints while maintaining backward
   compatibility
4. `fineTuneImprovement` produces valid tuned creatures with gradient hints
   active
5. All 2065 existing tests continue to pass

## Test Plan

- Added 23 new tests in `test/blackbox/GradientHint.ts`:
  - 9 tests for `applyGradientBias` (zero direction, zero magnitude, zero delta,
    aligned boost, negative aligned boost, flip on oppose, keep on oppose, low
    magnitude, partial magnitude)
  - 7 tests for `computeGradientHint` (no change, no improvement, negative
    improvement, positive direction, negative direction, magnitude scaling,
    magnitude bound)
  - 6 tests for `quantumAdjust` with gradient hints (basic usage, no diff,
    backward compatible, zero magnitude, combined with momentum, combined with
    adaptive params)
  - 1 integration test for `fineTuneImprovement` with gradient hints active
