## Summary

Final audit pass on mutation operator tests: removes remaining duplicate tests
from `ModWeightFocus.ts`. Closes #1769.

### Changes

**Duplicate tests removed (2 total):**

- `ModWeightFocus.ts`: Removed "mutate works without focus list" — duplicates
  `ModWeightBehavioural.ts` tests "successfully modifies a weight" and "weight
  actually changes value (not a no-op)"
- `ModWeightFocus.ts`: Removed "returns false when no synapses exist" —
  duplicates `ModWeightBehavioural.ts` test "returns false when creature has no
  synapses"

### Audit results

All 30 test files (171 test cases) in `test/mutate/` reviewed against criteria:

- **Uniqueness**: No remaining duplicate or near-duplicate tests
- **Behavioural testing**: All tests verify outcomes, not implementation details
- **Meaningful tests**: Every test exercises real code with real assertions
- **Organisation**: Tests are logically grouped and clearly named
- **Cross-area overlap**: `test/NEAT/Mutator*.ts` tests mutation at the
  orchestration level, `test/mutate/` tests operators directly — complementary,
  not duplicate

## Evidence

- All 171 tests in `test/mutate/` pass
- `./quality.sh --lint-only` and `./quality.sh --check-only` pass

## Test Plan

- Modified `test/mutate/ModWeightFocus.ts` — removed 2 duplicate tests
- All remaining tests verify behaviour with meaningful assertions
