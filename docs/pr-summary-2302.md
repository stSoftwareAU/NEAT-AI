## Summary

Fix forward-only validation crash caused by self-connection synapses surviving into the population. Closes #2302.

**Root cause:** `fix()` was called without `{ forwardOnly: true }` in two code paths, so self-connections on forward-only creatures were not removed:

1. **`Neat.populatePopulation`** — when cloned creatures were not selected for mutation (due to mutation rate < 1), the standalone `fix()` call did not remove self-connections. The `Mutator.repairAfterMutation` handles forward-only correctly, but only runs on mutated creatures.

2. **`CreatureTraining.applyLearnings`** — after backpropagation weight updates, `fix()` was called without the forward-only flag, so legacy self-connections could persist through training cycles.

**Defence-in-depth context:** The crash handler for `SELF_CONNECTION` in `validateFourX` (added in commit 63101914 for Issue #2139) already catches and repairs self-connections at breeding time. This PR additionally prevents them from entering the population in the first place.

## Evidence

No UI changes. Bug fix verified by 6 new tests plus all 5837 existing tests passing:

```
ok | 5837 passed (2 steps) | 0 failed | 3 ignored (55s)
```

## Test Plan

- Added `test/upgrade/BreedWithSelfConnectionParent.ts` (3 tests):
  - Offspring.breed succeeds when one parent has a self-connection
  - Offspring.breed succeeds when both parents have self-connections
  - prepareCreatureForBreeding repairs self-connections on large creatures
- Added `test/upgrade/PopulateFixForwardOnly.ts` (3 tests):
  - fix() with forwardOnly removes self-connections
  - fix() without forwardOnly preserves self-connections (documenting pre-fix behaviour)
  - populatePopulation pattern: clone + fix with forwardOnly removes self-connections
- Existing `test/upgrade/UpgradeRepairsSelfConnectionForwardOnly.ts` continues to pass (3 tests)
