## Summary

Integrate synthetic synapse generation and pruning into the training pipeline.
Before backpropagation begins, dense inter-layer synapses are generated; after
training completes, near-zero synthetic synapses are pruned and orphaned neurons
cleaned up. The feature is opt-in via `syntheticSynapses: true` in
`TrainOptions`. Closes #1923.

Changes:

- Added `syntheticSynapses: boolean` field to `TrainArguments` in
  `TrainOptions.ts` (default: false, opt-in)
- Modified `trainDirBinary()` in `Training.ts` to:
  1. Call `generateSyntheticSynapses()` before the training loop when enabled
  2. Invalidate WASM/state caches after structural changes
  3. Call `removeSyntheticSynapses()` after training completes
  4. Filter trace data to match the cleaned creature structure
- WASM and topology caches are properly invalidated at each stage via
  `clearState()` (after generation) and `clearState()` (after removal)

## Evidence

No regression in existing tests (feature is disabled by default). The 2
pre-existing test failures (`Find Closest Matching Species` and
`evolve_NOT_gate`) are confirmed to exist on the base branch without these
changes.

## Test Plan

Added 8 integration tests in `test/propagate/SyntheticSynapsesIntegration.ts`:

- `trainDir with syntheticSynapses=true completes without error`
- `syntheticSynapses=false does not alter synapse count`
- `synthetic synapses are pruned after training - creature validates`
- `syntheticSynapses default is off - no behaviour change without opt-in`
- `synthetic synapses with gappy creature can discover new connections`
- `compact output is valid when syntheticSynapses is enabled`
- `syntheticSynapses works with single iteration`
- `syntheticSynapses result error differs from non-synthetic training`
