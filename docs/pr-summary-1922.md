## Summary

Add `removeSyntheticSynapses()` to prune near-zero weight synthetic synapses
after training and clean up orphaned neurons that result from the removal.
Closes #1922.

Synthetic synapses that have been trained to meaningful weights (above a
configurable threshold) are retained as permanent connections. The function
leverages existing `disconnectBatch()` for efficient batch removal and
`cleanupOrphanedNeuronsInCreature()` for orphan handling (cascade-safe).

Safety rules enforced:
- Typed synapses (IF condition/positive/negative) are never removed
- Output neurons always retain at least one inward connection
- Orphaned hidden neurons are converted to constants or removed entirely

## Evidence

All 10 new tests pass. The pre-existing `Genus.ts` test failure is confirmed
unrelated (reproduces on the base branch without changes).

## Test Plan

- `test/propagate/RemoveSyntheticSynapses.ts` — 10 tests covering:
  - All near-zero synthetic synapses removed
  - Trained synthetic synapses retained
  - Orphaned hidden neuron converted to constant
  - Orphaned neuron removed (no outward connections)
  - Cascade removal
  - Output neuron protection (last inward connection preserved)
  - Typed synapse protection (IF condition/positive/negative)
  - Empty synthetic keys (no-op)
  - Custom threshold controls near-zero detection
  - Creature remains valid after removal
