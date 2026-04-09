## Summary

Extract shared numeric validation helpers (`assertFiniteNonNegative` and
`assertFiniteNumber`) into `src/utils/NumericValidation.ts` to eliminate
repeated NaN/finite/non-negative assertion patterns across `Score.ts`. Closes
#2222.

## Changes

- **New file `src/utils/NumericValidation.ts`**: Two helpers:
  - `assertFiniteNonNegative(value, name)` — asserts not NaN, finite, and >= 0
  - `assertFiniteNumber(value, name)` — asserts not NaN and finite (allows
    negative)
- **`src/architecture/Score.ts`**: Replaced 15 individual assertion calls with
  helper calls across `calculate()`, `calculatePenalty()`,
  `computeAndCacheScoreComponents()`, `updateScoreForWeightChange()`, and
  `updateScoreForBiasChange()`
- **`test/architecture/Score.ts`**: Updated one test expectation from
  `"not finite"` to `"is NaN"` since the helper now provides a more specific
  error message for NaN values (NaN is distinguished from Infinity)

## Evidence

All 5527 existing tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Added 15 unit tests in `test/utils/NumericValidation.ts` covering:
  - Valid inputs (zero, positive, small positive, negative for
    `assertFiniteNumber`)
  - NaN rejection with correct error message
  - Positive/negative Infinity rejection with correct error message
  - Negative number rejection with correct error message (for
    `assertFiniteNonNegative`)
  - Value inclusion in error messages
