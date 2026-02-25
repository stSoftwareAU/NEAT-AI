## Summary

Create shared test fixture module for common creature construction, eliminating
20 duplicate factory function definitions across test files. Closes #1602.

Three shared factory functions are provided in
`test/fixtures/SimpleCreatures.ts`:

- **`makeSimpleCreature()`** — 2-input, 1-hidden, 1-output IDENTITY creature
  with validate + UUID (was duplicated in 3 FailureCache test files)
- **`makeBaseCreature()`** — Same topology plus a direct input-1 → output-0
  synapse (was duplicated in 6 DiscoveryRunner test files)
- **`makeForwardOnlyCreature()`** — 1-input, 1-output forward-only IDENTITY
  creature (was duplicated in 9 DiscoveryReplayRunner/Queue test files)

Test files with unique topologies (BiasConvergence, AbstractMutationOperator,
InvalidDataDetection, CoordinatedStructuralCache, etc.) keep their local
fixtures unchanged.

## Evidence

This is a backend/test-only change with no UI component. All 4205 tests pass
after the refactoring, confirming no functional changes to test assertions.

## Test Plan

- Added `test/fixtures/SimpleCreatures.test.ts` with 4 tests verifying:
  - `makeSimpleCreature` returns valid 2-input, 1-output creature with UUID
  - `makeSimpleCreature` returns distinct instances per call
  - `makeBaseCreature` returns valid creature with 3 synapses including direct
    connection
  - `makeForwardOnlyCreature` returns valid 1-input, 1-output forward-only
    creature
- Updated 18 existing test files to import from shared fixtures
- All 4205 tests pass with `./quality.sh`
