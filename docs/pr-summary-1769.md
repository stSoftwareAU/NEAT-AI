## Summary

Final audit pass on mutation operator tests: removes remaining duplicate tests,
fixes a misleading test name, and strengthens weak assertions. Closes #1769.

### Changes

**Duplicate tests removed (7 total):**

- `AddConnectionNoRedundantValidation.ts`: Removed 3 tests that duplicated
  `AddConnectionBehavioural.ts` (forward-only constraint, standalone call,
  memetic flag)
- `ModWeightBehavioural.ts`: Removed 2 tests that duplicated
  `ModWeightRegularisation.ts` (maxAbsoluteWeight and maxWeightChange limits)
- `SubSelfCon.ts`: Removed 1 stress test that was near-identical to the existing
  stress test (same topology, same assertions)

**Misleading test name fixed:**

- `ModBiasRegularisation.ts`: Renamed "returns false when no valid neurons exist
  (with config)" to "skips constant neurons and mutates output neuron (with
  config)" — the test actually asserts mutation succeeds

**Weak assertions strengthened:**

- `AddConnectionBehavioural.ts`: Tightened weightScale assertion from `< 1` to
  `< 0.1` (scale is 0.01, so `< 1` was too lenient)
- `ModBias.ts`: "focus list targets specific neurons" now asserts the
  non-focused neuron's bias remains unchanged
- `ModBias.ts`: "handles creature with only output neurons" now verifies the
  bias value actually changed, not just that `mutate()` returned true

**Cross-area check:** No duplicate mutation operator tests found in `test/NEAT/`
— the references there are integration tests for broader workflows, not operator
unit tests.

## Evidence

- All 4724 tests pass
- `./quality.sh` passes cleanly (exit code 0)

## Test Plan

- Modified tests in `test/mutate/AddConnectionBehavioural.ts`,
  `test/mutate/AddConnectionNoRedundantValidation.ts`, `test/mutate/ModBias.ts`,
  `test/mutate/ModBiasRegularisation.ts`, `test/mutate/ModWeightBehavioural.ts`,
  `test/mutate/SubSelfCon.ts`
- Net reduction of 7 duplicate tests
- All remaining tests verify behaviour with meaningful assertions
