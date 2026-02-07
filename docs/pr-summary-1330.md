## Summary

Implements configurable adaptive quantum step sizing for memetic fine-tuning
(#1330).

Previously, the quantum step size (`MIN_STEP = 0.000_000_1`) was a fixed
constant. This change makes it adaptive based on training progress: larger steps
when far from the optimum (large score differences), smaller steps when
fine-tuning near convergence.

The effective step size is calculated as:

```
normalisedError = |scoreDiff| / (1 + |scoreDiff|)
effectiveStep = minStep * (1 + errorScale * normalisedError)
```

The result is clamped between `minStep` and `maxStep`.

### Key changes:

- New `QuantumStepConfig` configuration (`src/config/QuantumStepConfig.ts`) with
  `minStep`, `maxStep`, and `errorScale` parameters
- `calculateEffectiveStep()` function computes adaptive step size from score
  differences
- `quantumAdjust()` accepts optional `AdaptiveQuantumParams` for adaptive
  behaviour
- Config threaded through `fineTuneImprovement()`, `tuneRandomize()`, `retry()`
  from NEAT config
- Fully backward compatible - existing callers without config use the original
  fixed MIN_STEP

### Configuration options (all optional, defaults preserve existing behaviour):

| Option                   | Default       | Description                                   |
| ------------------------ | ------------- | --------------------------------------------- |
| `quantumStep.minStep`    | `0.000_000_1` | Minimum step size (floor)                     |
| `quantumStep.maxStep`    | `0.001`       | Maximum step size (ceiling)                   |
| `quantumStep.errorScale` | `10`          | How much error magnitude influences step size |

## Evidence

This is a backend/algorithmic change with no UI. The feature is verified through
unit tests and the full test suite (2022 tests passed, 0 failed).

## Test Plan

- `test/blackbox/AdaptiveQuantumStep.ts` - 11 tests verifying:
  - `calculateEffectiveStep` returns minStep when error is zero
  - `calculateEffectiveStep` returns minStep when errorScale is zero (disables
    adaptation)
  - Larger errors produce larger steps
  - Step never exceeds maxStep
  - Step never goes below minStep
  - Custom config values are respected
  - Negative errors use absolute value
  - Formula correctness with known values
  - `quantumAdjust` works with adaptive config
  - `quantumAdjust` remains backward compatible without adaptive config
  - maxStep equals minStep yields minStep
- `test/config/QuantumStepConfig.ts` - 7 tests verifying:
  - Defaults applied when not specified
  - Custom values override defaults
  - Partial overrides merge with defaults
  - String values coerced from CLI
  - maxStep < minStep throws validation error
  - Default values are sensible
  - errorScale zero disables adaptation
- All existing 2004 tests continue to pass unchanged
