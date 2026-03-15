## Summary

Final audit of mutation operator tests: removes Creature API tests misplaced in
`test/mutate/` and consolidates the unique constant-neuron exclusion test into
`AvailableConnectionsCache.ts`. Closes #1769.

### Changes

**AddConnectionOptimisation.ts removed (7 tests → 0):**

Six tests tested Creature's `getConnectionSet()`, `hasConnection()`, and
`getAvailableConnections()` methods — these are Creature API tests, not
AddConnection mutation behaviour tests. They are already covered by:

- `test/creature/CreatureTopology.ts` (getConnectionSet, hasConnection)
- `test/creature/SelectiveCacheInvalidation.ts` (cache invalidation)

The seventh test ("mutation adds connections and maintains validity") was a
near-duplicate of `AvailableConnectionsCache.ts` test "tracks correctly through
multiple mutations".

**One unique test moved:**

- "getAvailableConnections excludes constant neurons" moved to
  `AvailableConnectionsCache.ts` as "excludes constant neurons from targets" —
  the only test verifying this behaviour.

### Full audit results

All 29 test files (165 test cases) in `test/mutate/` reviewed against criteria:

- **Uniqueness**: No remaining duplicate or near-duplicate tests
- **Behavioural testing**: All tests verify outcomes, not implementation details
- **Meaningful tests**: Every test exercises real code with real assertions
- **Organisation**: Tests are logically grouped and clearly named
- **Cross-area overlap**: `test/NEAT/Mutator*.ts` tests mutation at the
  orchestration level, `test/mutate/` tests operators directly — complementary,
  not duplicate

## Evidence

- All 4716 tests pass
- `./quality.sh --lint-only` and `./quality.sh --check-only` pass

## Test Plan

- Removed `test/mutate/AddConnectionOptimisation.ts` — 6 Creature API tests
  already covered elsewhere, 1 near-duplicate
- Added "excludes constant neurons from targets" test to
  `test/mutate/AvailableConnectionsCache.ts`
- All remaining tests verify behaviour with meaningful assertions
