## Summary

Add optional per-output range constraints to `NeatOptions` that allow users to
specify the expected output range for each output neuron. Creatures that produce
outputs outside these ranges receive a configurable quadratic fitness penalty
proportional to the excess, normalised by the range span. Closes #1620.

### Key design decisions

- **Penalty is additive**: The penalty is added to the evaluation error (not the
  user's cost function), so it flows naturally into the fitness score.
- **Computed in the worker**: The penalty is calculated per-record during
  evaluation in the worker thread, alongside the cost function. This ensures
  penalties are based on actual evaluation outputs, not structural estimates.
- **Fused WASM disabled when active**: When `outputRanges` is set, the fused
  WASM scoring path is bypassed because it does not expose per-record outputs
  needed for the penalty calculation.
- **Fully optional**: When `outputRanges` is not specified (or empty), all
  existing behaviour is completely unchanged — no code paths are affected.

### Example usage

```ts
const options: NeatOptions = {
  outputRanges: [
    { min: -0.35, max: 0.35 },                  // 1st output: ±35%
    { min: -0.50, max: 0.50, penaltyWeight: 2 }, // 2nd output: ±50%, double penalty
  ],
};
```

## Evidence

This is a backend/config change with no UI. Verified via:
- 11 unit tests for penalty calculation (`test/architecture/OutputRangePenalty.ts`)
- 9 unit tests for config parsing and validation (`test/config/OutputRangeConfig.ts`)
- 3 integration tests verifying end-to-end worker pipeline behaviour
  (`test/architecture/OutputRangeIntegration.ts`)
- All 4245 existing tests pass unchanged

## Test Plan

- `test/architecture/OutputRangePenalty.ts` — Unit tests for `calculateOutputRangePenalty()`:
  - No penalty for in-range outputs and exact boundaries
  - Correct penalty for outputs below min and above max
  - `penaltyWeight` scaling
  - Multiple outputs accumulate penalties
  - Empty ranges produce zero penalty
  - Fewer ranges than outputs only constrains covered outputs
  - Works with `number[]` and `Float32Array`
  - Zero-width range uses raw excess
  - Quadratic scaling penalises large violations more
- `test/config/OutputRangeConfig.ts` — Config parsing tests:
  - Defaults to empty array when not specified
  - Accepts valid ranges with custom and default penalty weights
  - Validates min ≤ max and penaltyWeight ≥ 0
  - Allows single-point and negative ranges
  - Config is frozen/immutable
- `test/architecture/OutputRangeIntegration.ts` — Integration tests:
  - Tight range penalty increases error for out-of-range outputs
  - Wide range produces no penalty
  - Empty outputRanges has no effect on scores
