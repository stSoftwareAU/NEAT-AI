## Summary

Improved near-zero weight error propagation stability by clamping out-of-range
target activations to the squash range boundary instead of silently dropping
them. Closes #1873.

When a synapse weight is near zero, dividing by the minimum effective weight
(`plankConstant` = 1e-7) produces a target activation far outside the upstream
neuron's squash range (e.g., TANH [-1, 1]). Previously, these out-of-range
targets were dropped entirely, creating dead gradient paths through near-zero
weight connections. Now they are clamped to the range boundary, propagating a
reduced gradient instead.

### Changes

- **`src/propagate/TopologicalBackpropagation.ts`**: Replaced the out-of-range
  drop logic with
  `Math.max(range.low, Math.min(range.high, targetFromActivation))` clamping.
  The `Number.isFinite()` guard is preserved to maintain Issue #1314 protections
  against non-finite values.

- **`test/propagate/TinyWeightRecursionAvoidance.ts`**: Updated to reflect the
  new behaviour — gradient now propagates (clamped) through tiny weights instead
  of being dropped. The test verifies the bias changes and remains finite.

- **`test/propagate/NearZeroWeightClamping.ts`** (new): 5 tests verifying:
  - Gradient reaches hidden neurons through near-zero outbound weights
  - Hidden neuron bias updates via clamped gradient
  - Gradient flows through deep near-zero weight chains
  - No gradient explosion from clamped targets
  - Large creature stability with near-zero weight paths

## Evidence

All 4679 tests pass including the new and modified tests. The key tests that
failed before the fix (proving the bug existed) and pass after:

- `NearZeroWeightClamping - gradient reaches hidden neuron through near-zero outbound weight`
- `NearZeroWeightClamping - hidden bias updates through near-zero outbound weight`
- `NearZeroWeightClamping - gradient flows through deep near-zero chain`

## Test Plan

- Added `test/propagate/NearZeroWeightClamping.ts` with 5 tests for clamped
  gradient propagation
- Modified `test/propagate/TinyWeightRecursionAvoidance.ts` to assert new
  clamping behaviour (business logic change documented: gradient now propagates
  through tiny weights instead of being dropped)
- Existing `test/propagate/ZeroWeightRecovery.ts` tests continue to pass
- Full `./quality.sh` passes (4679 tests, 0 failures)
