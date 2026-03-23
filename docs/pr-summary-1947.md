## Summary

Detect and merge parallel IDENTITY bridge neurons during compaction. When
multiple hidden IDENTITY neurons each bridge a single input to the same output
neuron, they are collapsed into a single IDENTITY neuron with merged weights and
bias — reducing neuron count for an equivalent error. Closes #1947.

The merge is mathematically behaviour-preserving: setting `w_out = 1`,
`w_merged_i = w_out_i * w_in_i`, and `bias_merged = Σ(w_out_i * bias_i)` yields
identical activations at the target neuron.

Safety guards skip merging when:

- Bridge neurons share the same input source (would create duplicate synapses)
- A neuron has multiple inbound or outbound connections (not a simple bridge)
- The squash is not IDENTITY

## Files Changed

- `src/compact/ParallelIdentityMerge.ts` — new module implementing the detection
  and merge logic
- `src/compact/CompactCreature.ts` — integrates the new pass alongside existing
  compaction passes
- `test/compact/ParallelIdentityBridgeMerge.ts` — 8 unit tests covering
  detection, weight/bias calculation, edge cases, and topology preservation

## Test Plan

- `parallel IDENTITY merge: two bridge neurons to same target are merged`
- `parallel IDENTITY merge: weight calculation is correct`
- `parallel IDENTITY merge: bias contributions are correctly absorbed`
- `parallel IDENTITY merge: skips when would create duplicate synapses`
- `parallel IDENTITY merge: does not merge non-IDENTITY squash neurons`
- `parallel IDENTITY merge: does not merge neurons with multiple inbound connections`
- `parallel IDENTITY merge: preserves forward-only topology`
- `parallel IDENTITY merge: three bridge neurons merged correctly`
