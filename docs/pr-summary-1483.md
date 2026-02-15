## Summary

Add dedicated unit tests for five config modules that lacked test coverage.
Closes #1483.

The `src/config/` directory contains 13 source files but several had no
dedicated test files. This PR adds focused unit tests to improve confidence in
configuration validation and default value handling.

## Files Added

- `test/config/BiasRegularisationConfig.ts` — 8 tests covering defaults,
  overrides, CLI string coercion, Required type verification, boolean fields,
  and zero l2Strength edge case
- `test/config/DiscoveryMinCandidatesPerCategory.ts` — 8 tests covering
  defaults, overrides, partial overrides, CLI string coercion, zero values, and
  Required type verification
- `test/config/NeatArguments.ts` — 9 tests verifying the full argument
  structure, sub-object configs, default values, array fields, boolean fields,
  logger/RNG presence, and optional string fields
- `test/config/NeatOptions.ts` — 12 tests covering numeric string coercion,
  partial sub-object overrides, invalid input errors, seed/RNG determinism,
  verbose mode, and feedbackLoop validation
- `test/config/TrainOptions.ts` — 10 tests verifying type structure,
  backpropagation fields, adjustment scales, learning rate strategies, and full
  configuration acceptance

## Evidence

This is a backend testing change with no UI components. All 3685 tests pass
(including the 47 new tests) via `./quality.sh`.

## Test Plan

- Added `test/config/BiasRegularisationConfig.ts` (8 tests)
- Added `test/config/DiscoveryMinCandidatesPerCategory.ts` (8 tests)
- Added `test/config/NeatArguments.ts` (9 tests)
- Added `test/config/NeatOptions.ts` (12 tests)
- Added `test/config/TrainOptions.ts` (10 tests)
- All tests exercise real code via `createNeatConfig()` or type validation
- All tests pass via `./quality.sh` with 0 failures
