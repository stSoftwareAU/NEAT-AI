## Summary

Implements configurable quantum step size based on training progress for memetic
fine-tuning (#1330).

Previously, the quantum step size (`MIN_STEP = 0.000_000_1`) was a fixed
constant used throughout fine-tuning. This change makes the step size adaptive:
larger steps when far from the optimum (large score differences) and smaller
steps near convergence (small score differences).

### Changes

- **New config**: `QuantumStepConfig` with `minStep`, `maxStep`, and
  `scaleFactor` fields
- **New function**: `calculateStepSize()` computes adaptive step size using:
  `effectiveStep = minStep * (1 + scaleFactor * normalisedError)`, clamped to
  `[minStep, maxStep]`
- **Modified**: `quantumAdjust()` accepts an optional `stepSize` parameter for
  custom quantisation granularity
- **Modified**: `fineTuneImprovement()` and `tuneRandomize()` calculate and pass
  adaptive step sizes
- **Config pipeline**: `QuantumStepConfig` integrated into `NeatArguments`,
  `NeatOptions`, `NeatConfig` following the established config pattern
- **Threading**: Config passed through all callers (`Neat.ts`,
  `FineTunePopulation.ts`, `Retry.ts`)

### Defaults

| Field         | Default       | Description                                                 |
| ------------- | ------------- | ----------------------------------------------------------- |
| `minStep`     | `0.000_000_1` | Minimum step (backward compatible with previous `MIN_STEP`) |
| `maxStep`     | `0.000_1`     | Maximum step for coarse exploration                         |
| `scaleFactor` | `10`          | Controls sensitivity to score differences                   |

## Evidence

This is a backend/algorithmic change with no UI. Verified via:

- All 2009 existing tests continue to pass (backward compatibility preserved)
- New unit tests verify adaptive step size calculation and quantisation
  behaviour
- `./quality.sh` passes cleanly (fmt, lint, type-check, all tests)

## Test Plan

- `test/blackbox/QuantumStepSize.ts` - 10 tests for adaptive step size:
  - `calculateStepSize` returns `minStep` when scores are equal or no previous
    score
  - Larger score differences produce larger step sizes
  - Step size never exceeds `maxStep` or falls below `minStep`
  - Custom config values are respected
  - `scaleFactor` of zero always returns `minStep`
  - `quantumAdjust` uses custom step size for quantisation
  - Default step size preserves backward compatibility
  - Larger step sizes produce coarser quantisation
- `test/config/QuantumStepConfigParsing.ts` - 8 tests for config parsing:
  - Defaults used when not specified
  - Custom `minStep`, `maxStep`, `scaleFactor` accepted
  - String values accepted from CLI
  - Cross-field validation: `maxStep < minStep` throws
  - Negative `minStep` throws
  - Zero `scaleFactor` accepted
