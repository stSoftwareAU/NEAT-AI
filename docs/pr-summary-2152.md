## Summary

Add forward-only synapse guard to `addHelpfulNeurons()` in
`DiscoveryNeuronAddition.ts` to prevent backward connections when inserting new
neurons into forward-only creatures. This is the same class of issue as #2150 —
discovery operations that add synapses without forward-only guards, leading to
recurrent synapses being stripped during `loadFrom()`. Closes #2152.

## Changes

- **`src/architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronAddition.ts`**:
  - Built a UUID-to-index map (same pattern as `DiscoverySynapseOps.ts`) for
    forward-only creatures
  - Added pre-insertion forward-only guard that rejects candidates where the
    source neuron index >= target neuron index using UUID-based resolution
    (avoids runtime ID mis-resolution)
  - Added post-insertion verification ensuring the new neuron sits between its
    incoming source and outgoing target indices
  - Rebuilt the UUID-to-index map after each neuron insertion so subsequent
    candidates see correct indices
  - Added diagnostic logging and `recordDiscoveryIssue` calls for rejected
    candidates

## Evidence

Before the fix, the mixed-candidate test showed `loadFrom()` stripping a
backward synapse at load time:

```
🚨 [loadFrom] Stripping recurrent synapse 6->2 (fromUUID=output-0, toUUID=...) from forward-only creature
```

After the fix, the backward candidate is rejected at the source with a clear
diagnostic:

```
[Discovery TEST-MIXED] addHelpfulNeurons: Skipping candidate output-0 -> hidden-1: violates forward-only constraint (fromIdx=5, toIdx=2)
```

## Test Plan

- Added `test/ErrorGuidedStructuralEvolution/ForwardOnlyNeuronAdditionGuard.ts`
  with 5 tests:
  - Valid forward neuron addition produces no backward synapses
  - Backward candidate (hidden-2 -> hidden-1) is rejected
  - Neuron addition with output target maintains forward-only
  - Mixed candidates filtered correctly (only forward ones kept)
  - Self-referencing candidate (hidden-1 -> hidden-1) is rejected
- All 5239 existing tests pass with no regressions
