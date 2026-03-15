## Summary

Fourth-pass audit of all test files in `test/config/`, `test/validate/`, and
`test/architecture/` (46 files, ~400+ test cases) strengthening remaining weak
assertions and eliminating timing dependencies. Closes #1771.

### Changes Made

**Weak type-only assertions replaced with value assertions (3 files, 7 tests):**

- `NeatOptions.ts`: Replaced `typeof` checks with exact default value assertions
  (`populationSize === 50`, `mutationRate === 0.3`); strengthened seed
  determinism test to verify full 3-value sequence; verified `seeded === true`
  for CLI seed
- `TrainOptions.ts`: Replaced `typeof result.error === "number"` with
  `Number.isFinite(result.error)` and `result.error >= 0`; removed trivial
  `assertGreater(error, -Infinity)`; renamed tests to accurately describe what
  is verified
- `NeatArguments.ts`: Changed mutation test to verify each mutation has a name;
  changed selection test to assert exact default `"POWER"` instead of string
  length check

**Explicit assertions added (1 file, 1 test):**

- `ActivationRange.ts`: Added explicit `assertEquals(validatedCount, ...)` to
  replace implicit "no throw means pass" pattern

**Duplicate test differentiated (1 file, 1 test):**

- `DebugWriteDiagnostics.ts`: Renamed and clarified that this test specifically
  verifies DEBUG-mode error message content (vs CreatureValidate.ts which tests
  error reason)

**Timing removed from tests (1 file):**

- `ParallelFitnessEvaluation.ts`: Replaced `setTimeout(resolve, 1)` with
  `Promise.resolve()` in mock worker to eliminate timing dependency

**instanceof-only assertions strengthened (2 files, 3 tests):**

- `CreatureState.ts`: Added default value assertions (`count === 0`,
  `totalActivation === 0`) alongside instanceof checks for NeuronState and
  SynapseState
- `CreatureStateFlatArray.ts`: Added `totalActivation` and `totalErrorAbsolute`
  default assertions alongside instanceof check

**Minimal assertions strengthened (1 file, 2 tests):**

- `Offspring.ts`: Added `Number.isFinite(weight)` assertion for synapse weights;
  added UUID character format validation via regex

### Cross-area duplicates

- No new cross-area duplicates found

## Evidence

- All 4555 tests pass
- `./quality.sh` passes cleanly (lint, format, type-check, tests)
- 9 files changed across `test/config/`, `test/validate/`, `test/architecture/`

## Test Plan

- All 46 test files in `test/config/`, `test/validate/`, and
  `test/architecture/` re-reviewed
- Verified no regressions: full test suite (4555 tests) passes
- All remaining tests verify behaviour with meaningful assertions
- No timing dependencies remain in test files
