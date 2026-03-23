## Summary

Fix compact operations losing tags on synapses and neurons. Closes #1972.

The new compact logic (COMPLEMENT bypass, IDENTITY chain merge, parallel bridge
merging, orphaned neuron conversion) was creating new synapses and modifying
neurons without preserving their tags. This caused metadata tags to be silently
dropped during compaction.

### Fixes applied

1. **COMPLEMENT bypass** (`CompactCreature.ts`): New synapses created during
   bypass now carry merged tags from both the inbound and outbound synapses.
   When folding weight into an existing synapse, tags are also merged.

2. **IDENTITY chain merge** (`CompactCreature.ts`): The merged synapse now
   carries tags from both the inbound and outbound synapses being collapsed.

3. **Orphaned neuron conversion** (`OrphanedNeuronCleanup.ts`): When a hidden
   neuron with no inward connections is converted to a constant, its tags are
   now preserved.

4. **Parallel IDENTITY bridge merge** (`ParallelIdentityMerge.ts`): Tags from
   removed neurons are merged onto the kept neuron.

5. **Parallel bridge merge** (`ParallelBridgeMerge.ts`): Tags from removed
   neurons are merged onto the kept neuron.

All fixes use the existing `mergeTagsByNameValue()` utility to de-duplicate
tags by `{name, value}` equality.

## Evidence

8 new tests verify tag preservation across all compact operations. All existing
compact tests continue to pass.

## Test Plan

- Added `test/compact/CompactTagPreservation.ts` with 8 tests:
  - COMPLEMENT bypass preserves synapse tags on new synapses
  - COMPLEMENT bypass merges tags when adding to existing synapse
  - IDENTITY chain merge preserves synapse tags
  - Orphaned neuron conversion to constant preserves neuron tags
  - Parallel IDENTITY bridge merge preserves neuron tags on kept neuron
  - Parallel bridge merge preserves neuron tags on kept neuron
  - Parallel IDENTITY bridge merge preserves synapse tags
  - COMPLEMENT bypass preserves neuron tags on remaining neurons
