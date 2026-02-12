## Summary

Prove that backpropagation works correctly for all 32 standard squash (activation) functions by adding comprehensive property-based tests. Closes #1389.

Three new test files verify universal properties across every squash function:

1. **End-to-end convergence** (`BackpropConvergence.ts`): For each squash type, builds a minimal neural network (input -> hidden -> output), trains it with backpropagation, and verifies the output moves closer to the target. This exercises the full pipeline: `calculateError`, `safeZoneAdjustment`, elastic distribution, and weight/bias updates.

2. **`calculateError` properties** (`AllSquashProperties.ts`): Tests four mathematical invariants that must hold for every `calculateError()` implementation:
   - Perfect match returns zero error
   - Error is always finite (never NaN or Infinity)
   - A small step in the error direction improves the activation
   - Error is clamped within [-100, 100]

3. **`safeZoneAdjustment` properties** (`SafeZoneAllSquash.ts`): Tests three invariants for every `safeZoneAdjustment()` implementation:
   - Return value is always in [0, 1]
   - Non-finite raw input always returns 0
   - Return value is always finite

Also fixed a minor bug in `ABSOLUTE.safeZoneAdjustment()` which did not guard against non-finite raw input (every other squash function already had this guard).

## Evidence

This is a backend/test-only change with no visual output. All 2527 tests pass (including 256 new tests across the three files):
- 32 end-to-end convergence tests (one per squash function)
- 128 `calculateError` property tests (4 properties x 32 squash functions)
- 96 `safeZoneAdjustment` property tests (3 properties x 32 squash functions)

## Test Plan

- Added `test/propagate/BackpropConvergence.ts` — 32 tests proving convergence for all squash types
- Added `test/propagate/calculateError/AllSquashProperties.ts` — 128 property tests for `calculateError()`
- Added `test/propagate/SafeZoneAllSquash.ts` — 96 property tests for `safeZoneAdjustment()`
- Fixed `src/methods/activations/types/ABSOLUTE.ts` — added non-finite input guard to `safeZoneAdjustment()`
