## Summary

Extracted the shared `safeZoneAdjustment()` logic from 14 activation function
files into a single shared utility at
`src/methods/activations/SafeZoneAdjustment.ts`. The utility is configurable via
`safeMin`, `safeMax`, and optional `fadeWidth` parameters, eliminating all
duplicated safe zone logic. Addresses #1759.

## Changes

- **New file**: `src/methods/activations/SafeZoneAdjustment.ts` — shared utility
  function with configurable safe zone bounds and fade width (default 10).
- **Updated 14 activation files** to delegate to the shared utility:
  - Softplus (-10, 20), GELU (-6, 6), Mish (-10, 10), Swish (-10, 10)
  - ELU (-10, 10), SELU (-10, 10), StdInverse (-10, 10), SOFTSIGN (-10, 10)
  - ISRU (-10, 10), Exponential (-10, 30), LogSigmoid (-20, 20)
  - LeakyReLU (-50, 50, fadeWidth=20), GAUSSIAN (-3, 3, fadeWidth=3)
  - BIPOLAR_SIGMOID (-4, 4, fadeWidth=4)
- **New test file**: `test/methods/activations/SharedSafeZoneAdjustment.ts` — 23
  tests covering the shared utility directly.

## Evidence

All 4884 tests pass including:

- 96 existing `SafeZoneAdjustment.ts` tests (no regressions)
- 23 new `SharedSafeZoneAdjustment.ts` tests for the shared utility

## Test Plan

- Added `test/methods/activations/SharedSafeZoneAdjustment.ts` with 23 tests:
  - Non-finite input handling (NaN, Infinity, -Infinity)
  - Safe zone interior returns 1
  - Safe zone boundary returns 1
  - Weight improvement logic (too small/too large)
  - Outside safe zone with worsening error returns 0
  - Fade zone linear interpolation (above and below)
  - Far outside safe zone returns 0
  - Custom safeMin/safeMax (GELU, Softplus, Exponential bounds)
  - Custom fadeWidth (20, 3, 4)
  - All results in [0, 1] range with exhaustive input combinations
