## Summary

Fix discovery operations crashing with uncaught `AssertionError: FROM is undefined` when `Creature.fromJSON()` encounters a synapse referencing a non-existent neuron ID. Closes #2005.

The discovery pipeline modifies exported JSON (adding/removing neurons and synapses) before calling `Creature.fromJSON()`. If the modified JSON is invalid, the assertion in `loadFrom` crashed the entire process instead of gracefully skipping the candidate.

### Changes

- **Defensive try-catch**: Wrap `Creature.fromJSON()` in try-catch in all 6 discovery operations (`addHelpfulSynapses`, `addHelpfulNeurons`, `changeSquash`, `removeSynapse`, `removeHarmfulNeuron`, `removeLowImpactNeuron`) so they return `undefined`/`null` gracefully instead of propagating an uncaught exception
- **Diagnostic error message**: Improve the `FROM is undefined` assertion in `CreatureSerialization.ts` `loadFrom` to include `fromId`, `fromUUID`, synapse index, and `idMap` size for future debugging
- **Tests**: Add 10 tests verifying graceful handling of invalid candidates through both the application layer and the candidate creation layer

## Evidence

- All 4977 tests pass (0 failed)
- New test file `test/ErrorGuidedStructuralEvolution/DiscoveryFromJSONRobustness.ts` with 10 tests

## Test Plan

- `Creature.fromJSON provides diagnostic info when synapse references missing neuron` - verifies error message includes fromId value
- `addHelpfulSynapses returns undefined for non-existent source/target neuron ID` - verifies graceful handling
- `addHelpfulNeurons returns undefined for non-existent source neuron ID` - verifies graceful handling
- `removeSynapse returns null for non-existent source neuron` - verifies graceful handling
- `removeHarmfulNeuron returns undefined for non-existent neuron` - verifies graceful handling
- `changeSquash returns undefined for non-existent neuron` - verifies graceful handling
- `removeLowImpactNeuron returns undefined for non-existent neuron` - verifies graceful handling
- `buildSingleSynapseCandidates gracefully skips invalid candidates` - verifies end-to-end candidate pipeline
- `buildSingleNeuronCandidates gracefully skips invalid candidates` - verifies end-to-end candidate pipeline
