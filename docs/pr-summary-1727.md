## Summary

Add direct test coverage for three previously untested modules:
`NoChangePropagate`, `CandidateCreation`, and `CandidateApplicationOps`. Closes
#1727.

## Evidence

All 44 new tests pass and exercise real code paths with test data:

- **NoChangePropagate** (9 tests): Covers standard IDENTITY path (bias/count
  accumulation, activation tracing), `noChange = true` short-circuit,
  NeuronActivationInterface path (IF squash), input neuron skip, and multi-layer
  recursive propagation.
- **CandidateCreation** (20 tests): Covers all builder functions —
  `buildSingleSynapseCandidates`, `buildSingleNeuronCandidates`,
  `buildSingleSquashCandidates`, `buildLowImpactRemovalCandidates`,
  `buildHarmfulNeuronRemovalCandidate`, and
  `buildHarmfulSynapseRemovalCandidates` — including empty/undefined input
  guards and valid candidate creation.
- **CandidateApplicationOps** (15 tests): Covers `applyAddSynapses`,
  `applyAddNeurons`, `applyChangeSquash`, `applyRemoveSynapse`,
  `applyRemoveNeuron`, and `buildUuidToIndexMap` — including forward-only
  enforcement, non-existent endpoint handling, and no-op returns.

## Test Plan

- Added `test/architecture/NoChangePropagate.ts` (9 tests)
- Added `test/discovery/CandidateCreation.ts` (20 tests)
- Added `test/discovery/CandidateApplicationOps.ts` (15 tests)
- All tests run via `./quality.sh`
