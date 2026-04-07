## Summary

Add DEBUG-gated forward-only topology assertions after all four bulk index
remapping operations to catch `from >= to` synapse violations early. Closes #2191.

The new shared helper `assertForwardOnlyTopologyAfterBulkRemap()` in
`ForwardOnlySynapseGuard.ts` checks all synapses satisfy `from < to` and
includes the operation name in any error message for diagnosis.

Operations protected:
- `insertNeuron()` in `AddNeuron.ts`
- `removeHiddenNeuron()` in `OrphanedNeuronCleanup.ts`
- `moveNeuronToIndex()` and `normaliseComputationalNeuronOrder()` in `NormaliseComputationalNeuronOrder.ts`
- `Offspring.breed()` in `Offspring.ts`

## Evidence

All 5363 existing tests pass. The assertions are gated by `creature.DEBUG` so
there is zero overhead in production.

## Test Plan

- Added `test/architecture/ForwardOnlyTopologyAfterBulkRemap.ts` with 7 tests:
  - `insertNeuron` preserves forward-only topology (simple creature)
  - `insertNeuron` preserves forward-only topology (larger creature)
  - `removeHiddenNeuron` preserves forward-only topology
  - `removeHiddenNeuron` at first hidden preserves forward-only topology
  - `normaliseComputationalNeuronOrder` preserves forward-only topology
  - `Offspring.breed` preserves forward-only topology
  - Repeated `insertNeuron` mutations preserve forward-only topology
