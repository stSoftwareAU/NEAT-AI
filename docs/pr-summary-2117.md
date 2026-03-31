## Summary

Fix `compactUnused` leaving orphaned neurons with no outward connections after
removing a hidden neuron. The existing `cleanupOrphanedNeuronsInCreature()`
function handles exactly this case but was not called between `removeNeuron()`
and `validateOrDiagnose()`. Added the missing call so orphaned feeder neurons
are cascade-removed before validation. Closes #2117.

## Changes

- **src/compact/CompactUnused.ts**: Added call to
  `cleanupOrphanedNeuronsInCreature()` after `removeNeuron()` succeeds and
  before `validateOrDiagnose()`, cleaning up any hidden neurons left with no
  outward connections.

## Evidence

All 5176 tests pass including 2 new tests that exercise the orphan scenario.

## Test Plan

- Added `test/compact/CompactUnusedOrphanCleanup.ts` with two tests:
  - `compactUnused - no orphaned neurons after removal (issue #2117)`: verifies
    a two-neuron chain where the feeder neuron becomes orphaned after removal
  - `compactUnused - cascade cleanup of chain of orphaned neurons (issue #2117)`:
    verifies a three-neuron chain where multiple neurons cascade-orphan
- All existing compact tests continue to pass unchanged
