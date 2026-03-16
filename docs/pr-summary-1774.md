## Summary

Audit all root-level test files (`test/*.ts`) and utility tests (`test/utils/`)
to ensure they meet quality standards. Closes #1774.

### Removed duplicate test files (6 files)

- `test/Costs.ts` - fully duplicated by `test/costs/CostsRegistry.ts` and
  individual cost test files
- `test/ConfigValidate.ts` - duplicated by
  `test/config/NeatOptionsRuntimeValidation.ts` and
  `test/config/NeatConfigParseOptions.ts`
- `test/addConnection.ts` - trivial smoke test with no assertions, fully covered
  by `test/mutate/AddConnectionBehavioural.ts`
- `test/addNeuron.ts` - duplicated by `test/mutate/AddNeuron.ts` and
  `test/mutate/AddNeuronFocusSelection.ts`
- `test/subNeuron.ts` - duplicated by `test/mutate/SubNeuron.ts`
- `test/WasmCalculateErrorComprehensive.ts` - duplicated by
  `test/WasmCalculateErrorBasic.ts` and `test/WasmCalculateErrorAdvanced.ts`

### Improved test assertions (3 files)

- `test/Learn.ts` - replaced no-assertion placeholder with real assertions on
  training result (finite error, non-negative, creature remains valid)
- `test/InFocus.ts` - strengthened weak `count > 0` assertions with total count
  validation and descriptive messages
- `test/Traced.ts` - split into two focused tests with meaningful assertions
  (compact validation, applyLearnings modification)

### Improved test names (4 files)

- `test/Elitism.ts` - renamed cryptic names (`1make`, `3make`, `3make2`,
  `short`, `backwards`, `forward`, `order`, `logVerbose`) to descriptive names
  explaining the behaviour being verified
- `test/Fix.ts` - renamed `FromFrom` to
  `fix: is idempotent - second fix does not change creature`
- `test/ActivationNames.ts` - renamed test and removed commented-out code
- `test/CostNameTypes.ts` - added meaningful runtime assertion and improved test
  name

### Removed duplicate/unnecessary tests (2 files)

- `test/Elitism.ts` - removed `performance` test that used
  `performance.mark/measure` (timing in unit tests is unreliable per project
  guidelines)
- `test/TopologyHash.ts` - removed duplicate "different squash functions" test
  (lines 264-300 duplicated lines 92-128)

## Evidence

- All 4493 tests pass
- `./quality.sh` passes cleanly

## Test Plan

- Verified all removed tests have equivalent coverage in subdirectory test files
- Verified all modified tests still pass with strengthened assertions
- Full test suite passes (4493 tests, 0 failures)
