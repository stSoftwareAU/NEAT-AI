## Summary

Audited and fixed orphaned neuron cleanup to prevent dangling synapse references. Closes #2015.

The `cleanupOrphanedNeurons()` function previously only filtered synapses by `toId` when removing orphaned neurons. While orphans by definition have no outward connections (so no `fromId` references should exist), upstream bugs could violate this assumption and leave dangling `fromId` references. This change adds a defensive `fromId` check to the synapse filter and integrity assertions within the cleanup loop.

### Changes

1. **Defensive synapse cleanup** (`src/compact/OrphanedNeuronCleanup.ts`): The second-pass synapse filter now checks both `s.toId` and `s.fromId` against the orphan set, ensuring no dangling references even if the "no outward connections" assumption is violated by upstream bugs.

2. **Integrity assertions**: Added `assertValidSynapseReferences()` calls at the end of each iteration in the `do-while` loop and after the function completes, catching any dangling references immediately.

3. **7 new corner-case tests** (`test/compact/OrphanedNeuronCornerCases.ts`):
   - Deep cascade removal (A->B->C->D chain)
   - Hidden-to-constant conversion followed by orphaning
   - Multiple neurons orphaned simultaneously
   - Constant neuron with only inward connections
   - Self-referencing synapse edge case
   - Defensive fromId cleanup verification
   - No dangling fromId after orphan removal

## Evidence

All 5005 tests pass including 7 new corner-case tests. `./quality.sh` passes cleanly.

## Test Plan

- Added `test/compact/OrphanedNeuronCornerCases.ts` with 7 new tests covering all scenarios from the issue
- Existing 9 tests in `test/compact/CleanupOrphanedNeurons.ts` continue to pass
- All tests verified via `./quality.sh`
