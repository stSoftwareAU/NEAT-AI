## Summary

Audit and fix discovery operations to prevent invalid creatures by adding
integrity assertions (`assertValidSynapseReferences`) before every
`Creature.fromJSON()` call and writing corner-case tests for cascade scenarios.
Closes #2016.

## Changes

### Integrity assertions added to all 6 discovery operations:

- **`removeSynapse`**: After synapse filtering and after
  `cleanupOrphanedNeurons()`
- **`addHelpfulSynapses`**: Before `Creature.fromJSON()`
- **`removeHarmfulNeuron`**: After neuron/synapse removal and after
  `cleanupOrphanedNeurons()`
- **`removeLowImpactNeuron`**: After neuron/synapse removal and after
  `cleanupOrphanedNeurons()`
- **`addHelpfulNeurons`**: Before `Creature.fromJSON()`
- **`changeSquash`**: Before `Creature.fromJSON()`

### No bugs found

All existing discovery operations correctly handle cascade cleanup. The
`cleanupOrphanedNeurons()` function (fixed in #2015) properly handles all tested
scenarios including deep cascades, hub neurons, self-loops, and constant neuron
downstream cleanup.

## Evidence

All 5012 tests pass including 7 new corner-case tests. No bugs were found - the
assertions confirm the operations are already correct.

## Test Plan

New test file:
`test/ErrorGuidedStructuralEvolution/DiscoveryOperationIntegrity.ts`

7 corner-case tests covering:

- `removeSynapse`: deep cascade cleans up entire chain
- `removeHarmfulNeuron`: hub neuron removal cascades to dependants
- `removeLowImpactNeuron`: downstream constant neuron cleaned up
- `addHelpfulNeurons`: output contiguity maintained with multi-output creature
- `removeSynapse`: self-loops do not prevent orphan cleanup
- `removeHarmfulNeuron`: sequential removal of chained neurons
- `removeSynapse`: three-deep cascade fully resolved
