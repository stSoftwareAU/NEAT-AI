## Summary

Audit of all test files in `test/config/`, `test/validate/`, and
`test/architecture/` (47 files, ~423 test cases) for quality, uniqueness, and
behavioural testing. Closes #1771.

### Changes Made

**Duplicates removed (8 duplicate tests):**

- `CreatureValidate.ts`: Removed 2x duplicate "Neuron length" test and 2x
  duplicate "expected index" tests (kept 1 of each)
- `ActivationRange.ts`: Removed duplicate loop blocks in both test cases

**"How" tests rewritten as "what" tests:**

- `DebugWriteDiagnostics.ts`: Removed file path implementation detail checks
  (checking `DIAGNOSTICS_DIR` vs `.test` path); now tests the actual validation
  behaviour (duplicate UUID detection + error message)

**Meaningless/trivial tests removed or replaced:**

- `TrainOptions.ts`: Replaced 10 type-only tests (just creating objects and
  reading properties back) with 3 behavioural tests that exercise actual
  training via `evolveDataSet`
- `PredictionNodeState.ts`: Removed entirely — tested a pure TypeScript
  interface (compile-time, not runtime)
- Removed 7 "default values are sensible" tests that checked constants against
  themselves (BiasRegularisation, DiscoveryMinCandidatesPerCategory, DiskSpace,
  PredictiveCoding, WasmCache)
- Removed 2 "Required type fills all fields" tests that only checked `typeof`
  (BiasRegularisation, DiscoveryMinCandidatesPerCategory)
- Removed duplicate "disabled by default" test in PredictiveCodingConfig
- Consolidated 3 trivial NeuronStatePredictiveCoding property tests into 1

**Redundant tests consolidated:**

- `FeedbackLoopCondition.ts`: Consolidated 4 near-identical "allows recursive
  synapses" tests into 1 test covering all variants

**Test names improved:**

- `CreatureValidate.ts`: Renamed 12 tests with descriptive behavioural names
  (e.g., "Input" → "validate rejects negative input count")

**Assertions fixed:**

- `TrainingEvent.ts`: Replaced no-op `assertStringIncludes(event.kind, "")` with
  meaningful `assertGreater(event.kind.length, 0)`

**Files not requiring changes (clean):**

- All 18 `test/architecture/` files (except NeuronStatePredictiveCoding and
  PredictionNodeState) — excellent quality
- Most `test/config/` files — well-structured config parsing tests
- `test/validate/CreatureValidate.ts` (remaining tests after dedup) — good
  validation coverage

### Cross-area duplicates

- No cross-area duplicates found between `test/config/` and `test/validate/`

## Evidence

- All 4565 tests pass
- `./quality.sh` passes cleanly (lint, format, type-check, tests)
- Net reduction: 255 lines removed, 13 files changed, 1 file deleted

## Test Plan

- All existing tests in `test/config/`, `test/validate/`, and
  `test/architecture/` reviewed
- Added meaningful tests: `ActivationRange` valid-value and clamping tests,
  `TrainOptions` behavioural integration tests
- Verified no regressions: full test suite (4565 tests) passes
