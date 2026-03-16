## Summary

Final audit pass on mutation operator tests: strengthens weak compound
assertions in `AddNodeOutwardConnections.ts` by replacing `assert(a && b)` with
separate `assertEquals()` calls for clearer failure diagnostics. Closes #1769.

### Full audit results

All 29 test files (165 test cases) in `test/mutate/` reviewed against criteria:

- **Uniqueness**: No remaining duplicate or near-duplicate tests
- **Behavioural testing**: All tests verify outcomes, not implementation details
- **Meaningful tests**: Every test exercises real code with real assertions
- **Assertion quality**: All assertions use specific assertion functions
  (`assertEquals`, `assertThrows`, etc.) — no compound boolean `assert()` calls
- **Organisation**: Tests are logically grouped and clearly named
- **Cross-area overlap**: `test/NEAT/Mutator*.ts` tests mutation at the
  orchestration level, `test/mutate/` tests operators directly — complementary,
  not duplicate

## Evidence

- All tests pass
- `./quality.sh` passes

## Test Plan

- Strengthened assertions in `test/mutate/AddNodeOutwardConnections.ts` —
  replaced compound `assert(a && b)` with separate `assertEquals()` calls
- All remaining tests verify behaviour with meaningful assertions
