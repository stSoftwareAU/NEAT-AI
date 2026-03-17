## Summary

Add comprehensive unit tests for the core backpropagation modules:
`BackPropagation.ts`, `Weight.ts`, `Bias.ts`, `ErrorHelper.ts`, and
`RecordElasticity.ts`. These 88 new tests cover config creation, learning rate
strategies, weight/bias accumulation and calculation, error clamping, and
elastic error distribution — all previously untested directly. Closes #1399.

## Evidence

This is a test-only change with no UI or performance modifications. All 2791
tests (including 88 new) pass via `./quality.sh`.

## Test Plan

### New test files (88 tests total):

- **`test/propagate/BackPropagationConfig.ts`** (23 tests)
  - `createBackPropagationConfig`: frozen config, explicit overrides, clamping
    of learningRate/generations/limitBiasScale/limitWeightScale, fixed strategy
    detection, default flags
  - `calculateLearningRate`: fixed strategy, decay strategy, adaptive strategy
    (improving/stagnating/worsening error feedback, non-finite feedback, zero
    previousError)
  - `limitValue`: normal values, NaN, ±Infinity, boundary at 1e12

- **`test/propagate/WeightCalculation.ts`** (18 tests)
  - `accumulateWeight`: positive/negative/zero activation tracking, non-finite
    input skipping, multiple sample accumulation
  - `calculateWeight`: disabled adjustment, zero count, generational blending
  - `limitWeight`: tiny target, tiny difference, learning rate scaling,
    maximumWeightAdjustmentScale clamping, limitWeightScale enforcement, zero
    gradient

- **`test/propagate/BiasCalculation.ts`** (16 tests)
  - `accumulateBias`: positive/negative/zero delta, non-finite input skipping,
    multiple sample accumulation
  - `limitBias`: tiny target, negligible difference, learning rate scaling,
    maximumBiasAdjustmentScale clamping, non-finite rejection, limitBiasScale
    enforcement, large gradient handling

- **`test/propagate/ErrorHelperTest.ts`** (9 tests)
  - `calculateClampedError`: normal values, default/custom maxMagnitude
    clamping, NaN/±Infinity returns 0, boundary values

- **`test/propagate/RecordElasticityTest.ts`** (22 tests)
  - `recordTargetFeasibilityFactor`: IDENTITY/ReLU/Swish/ABSOLUTE squash types,
    in-range/out-of-range targets, non-finite targets
  - `distributeRecordError`: empty links, non-finite error, single link, weight²
    proportional distribution, safeZoneFactor/feasibilityFactor gating, blocked
    links with/without fallback, shares sum preservation, negative error
  - `constrainAndRedistributeRecordShares`: input passthrough, zero-weight
    redistribution, blocked safe-zone redistribution, sum preservation, negative
    error, range-limited squash redistribution with real creature
