## Summary

Second-pass audit of all test files in `test/config/`, `test/validate/`, and
`test/architecture/` (46 files, ~400+ test cases) addressing remaining quality
issues found after PR #1817. Closes #1771.

### Changes Made

**Duplicate tests removed (10 tests across 3 files):**

- `NeatArguments.ts`: Removed 5 tests that duplicated coverage already in
  `ConfigurationGuideDefaults.ts` and individual config test files:
  - "default config has all required top-level fields" (just typeof checks)
  - "default config has all sub-object configs" (just existence checks)
  - "sub-object configs match their defaults" (duplicated by individual tests)
  - "default boolean fields have expected values" (duplicated by ConfigurationGuideDefaults)
  - "default numeric fields have expected values" (duplicated by ConfigurationGuideDefaults)
- `NeatConfigParseOptions.ts`: Removed 4 duplicate tests:
  - "discoverySampleRate default is 0.2" (duplicated by "missing uses default")
  - "discoveryRecordTimeOutMinutes default is 5" (duplicated by "missing uses default")
  - "discoverySampleRate explicit override still works" (covered by other tests)
  - "discoveryRecordTimeOutMinutes explicit override still works" (consolidated)
- `FeedbackLoopCondition.ts`: Removed "feedbackLoop false rejects recursive
  synapses" (identical test already in `CreatureValidate.ts`)

**"How" tests rewritten as "what" tests (2 tests):**

- `LoggerConfig.ts`: Replaced `Object.isFrozen(config)` check with behaviour
  test that asserts property assignment throws
- `OutputRangeConfig.ts`: Same `Object.isFrozen` to behaviour test rewrite

**Assertion quality improved (3 files):**

- `NeatOptionsRuntimeValidation.ts`: Replaced 3 manual `if/throw` checks
  with proper `assertEquals` assertions
- `NeatConfigParseOptions.ts`: Replaced 5 `try/catch/fail` blocks with
  `assertThrows`/`assertStringIncludes` for cleaner error validation
- `AdaptiveMutationThresholds.ts`: Replaced 2 `try/catch/fail` blocks with
  `assertThrows`

**Duplicate tests consolidated (1 test):**

- `ActivationRange.ts`: Merged two near-identical validate rejection tests
  (with and without neuron index) into a single test

### Cross-area duplicates

- No cross-area duplicates found between `test/config/` and `test/validate/`

## Evidence

- All 4555 tests pass
- `./quality.sh` passes cleanly (lint, format, type-check, tests)
- Net reduction: 254 lines removed, 8 files changed

## Test Plan

- All 46 test files in `test/config/`, `test/validate/`, and
  `test/architecture/` reviewed
- Verified no regressions: full test suite (4555 tests) passes
- All remaining tests verify behaviour, not implementation details
