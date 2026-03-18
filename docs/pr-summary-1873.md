## Summary

Improve near-zero weight error propagation stability by clamping out-of-range
targets to the squash function's range boundary instead of silently dropping
them. Closes #1873.

When a synapse weight is near zero, dividing by the effective weight
(plankConstant ≈ 1e-7) produces extreme `targetFromActivation` values that fall
outside the upstream neuron's squash range. Previously these were silently
dropped via an `outOfRange` check, creating dead gradient paths through
near-zero-weight connections. In large creatures with many near-zero weight
synapses, this prevented gradient signal from reaching significant portions of
the network.

The fix replaces the drop-on-out-of-range behaviour with `Math.max(range.low,
Math.min(range.high, targetFromActivation))`, so a reduced gradient always
propagates through near-zero-weight connections. This preserves all existing
finite value protections (Issue #1314) since `Number.isFinite(clampedTarget)` is
still checked before accumulation.

## Evidence

- All 4678 tests pass including 573 propagate-specific tests
- `./quality.sh` passes cleanly
- No non-finite values introduced (verified by dedicated test)
- Updated `TinyWeightRecursionAvoidance` test to verify finite bounds instead
  of zero change, reflecting the intentional new behaviour

## Test Plan

- Added `test/propagate/NearZeroWeightGradientPropagation.ts` with 4 tests:
  - Clamped gradient propagates through near-zero weight with TANH
  - Upstream neuron receives gradient through near-zero weight
  - No non-finite values from clamped propagation
  - Multiple near-zero weights do not block all gradient paths
- Updated `test/propagate/TinyWeightRecursionAvoidance.ts`: assertion changed
  from exact-zero bias change to finite-value check, since clamped gradient
  now correctly propagates a reduced signal (documented business logic change)
