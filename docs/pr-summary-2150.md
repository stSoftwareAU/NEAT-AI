## Summary

Added a forward-only synapse guard to `addHelpfulSynapses()` in
`DiscoverySynapseOps.ts`. The function now rejects backward and self-loop
synapses for forward-only creatures before they are pushed to
`exportJSON.synapses`, preventing the downstream `loadFrom` stripping messages
that indicated upstream corruption. Closes #2150.

## Evidence

Before the fix, `addHelpfulSynapses()` would add invalid synapses that were then
stripped by `loadFrom` with:

```
🚨 [loadFrom] Stripping recurrent synapse 3736->3736 (fromUUID=output-0, toUUID=output-0) from forward-only creature
```

After the fix, the synapses are rejected at source with a clear warning:

```
[Discovery ID] Skipping synapse output-0 -> output-0: violates forward-only constraint (fromIndex=3, toIndex=3)
```

## Test Plan

- Added
  `test/ErrorGuidedStructuralEvolution/ForwardOnlySynapseGuardDiscovery.ts` with
  4 tests:
  - `addHelpfulSynapses rejects self-loop synapse for forward-only creature`
  - `addHelpfulSynapses rejects backward synapse for forward-only creature`
  - `addHelpfulSynapses allows valid forward synapse for forward-only creature`
  - `addHelpfulSynapses filters mixed candidates keeping only forward ones`
