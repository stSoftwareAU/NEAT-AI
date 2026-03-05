## Summary

Add test coverage for neuron/, compact/, and optimize/ modules that previously had no dedicated unit tests. Closes #1697.

New test files cover:
- **neuron/NeuronActivation.ts** — type guard functions (`isNodeActivation`, `hasApplyLearnings`, `isFixableActivation`)
- **neuron/NeuronSerialization.ts** — JSON export/import round-tripping (`exportJSON`, `fromJSON`, `internalJSON`)
- **neuron/NeuronTopology.ts** — mutation and topology fixing (`mutate`, `fix`)
- **compact/CompactUtils.ts** — utility functions (`mergeDuplicateSynapses`, `pruneZeroWeightSynapses`, `pruneDeadSubgraphs`, `cleanupOrphanedNeurons`, `cleanupMemeticForRemovedSynapse`, `cleanupMemeticForRemovedNeuron`)
- **compact/CompactCreature.ts** — creature compaction (`compactCreature` with COMPLEMENT bypass, chain compaction, dead neuron removal)
- **optimize/FunctionCache.ts** — activation function caching (`findActivationFunction`)
- **optimize/makeSynapsesValue.ts** — synapse value string generation

## Evidence

All tests exercise real code paths with test data — no grep-based or pattern-matching tests. All 4477 tests pass (including the new ones) via `./quality.sh`.

## Test Plan

- `test/neuron/NeuronActivation.ts` — 10 tests for type guard functions
- `test/neuron/NeuronSerialization.ts` — 14 tests for serialisation round-trips
- `test/neuron/NeuronTopology.ts` — 11 tests for mutation and topology fixing
- `test/compact/CompactUtils.ts` — 17 tests for compaction utility functions
- `test/compact/CompactCreature.ts` — 6 tests for creature compaction
- `test/optimize/FunctionCache.ts` — 6 tests for function caching
- `test/optimize/makeSynapsesValue.ts` — 4 tests for synapse value generation
