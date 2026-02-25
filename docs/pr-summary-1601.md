## Summary

Consolidate duplicate per-activation test files into parametric suites, eliminating
significant test duplication. Closes #1601.

### Changes

**test/squash/activations/** — Removed 33 redundant per-activation test files
(plus 1 README). These tested derivative values, unSquash roundtrip, and non-finite
input handling individually per activation function. The parametric suites in
`test/methods/activations/` already cover all these properties:

- `SquashDerivative.ts` — individual squash/derivative values for all 32+ activations
- `SquashRoundtrip.ts` — squash/unSquash roundtrip for all activations
- `RangeBounds.ts` — range compliance for all activations
- `EdgeCases.ts` — x=0, large values, non-finite inputs, boundaries
- `Monotonicity.ts` — monotonicity properties

Retained `UnSquashHintTest.ts` as it provides unique coverage for the hint mechanism
with far-away hints (periodic functions, saturation regions).

**test/propagate/calculateError/** — Removed 32 redundant per-activation test files.
Created a single parametric `CalculateErrorDerivativeFormula.ts` that consolidates:

- Derivative-based formula verification (`error = rawError / slope`) across all 20
  activations that use this formula
- Vanishing gradient fallback behaviour (17 test cases across activations)
- Discrete activation magnitude tests (BIPOLAR, STEP threshold crossing)
- Boundary behaviour tests (STEP threshold, ReLU flat region, ReLU6 active zone)
- IDENTITY exact error values and clamping

Retained `AllSquashProperties.ts` as it was already parametric, testing 4 universal
properties across all activations.

### File count impact

- Removed: 66 files (33 squash + 32 calculateError + 1 README)
- Added: 1 file (CalculateErrorDerivativeFormula.ts)
- Net reduction: 65 files, ~4,295 lines removed

## Evidence

This is a backend test consolidation with no visual changes.
All 4,201 tests pass after the consolidation.

## Test Plan

- Verified all existing parametric tests in `test/methods/activations/` still pass
- Verified `test/propagate/calculateError/AllSquashProperties.ts` still passes
- New `CalculateErrorDerivativeFormula.ts` passes all tests:
  - 20 derivative formula verification tests (one per activation)
  - 17 vanishing gradient fallback tests
  - 7 activation-specific edge case tests (BIPOLAR, STEP, ReLU, ReLU6, IDENTITY)
- Full quality gate (`./quality.sh`) passes with 4,201 tests
