## Summary

Remove redundant `downstreamCount` repetition loops in topological backpropagation
and add tests verifying accumulation counts reflect actual training samples.
Closes #1652.

The `downstreamCount` repetition loops (which artificially inflated
`SynapseState.count` and `NeuronState.count` by repeating accumulation calls
once per downstream connection) were already removed as part of the
complementary error signal summing fix (#1651/#1664). This PR adds dedicated
tests that verify the accumulation counts are correct and will catch any
future regression.

### Changes

1. **Added `test/propagate/AccumulationCounts.ts`** — 4 tests verifying that
   `SynapseState.count` and `NeuronState.count` reflect actual training samples,
   not fan-out multiplied counts
2. **No source code changes needed** — the `downstreamCount` loops were already
   removed in PR #1664 (issue #1651)

## Evidence

This is a backend logic fix with no UI changes.

- **Synapse count test**: Verifies `SynapseState.count` equals training samples
  (not samples × fan-out) for a neuron feeding 3 downstream outputs
- **Neuron count test**: Verifies `NeuronState.count` equals training samples
  (not samples × fan-out) for a neuron feeding 3 downstream outputs
- **Comparative test**: Confirms single-output and triple-output networks
  produce identical accumulation counts for the same number of training samples
- **Output synapse test**: Verifies each outgoing synapse from a fan-out neuron
  has count equal to training samples
- **All 4,323 tests pass** including all existing convergence tests

## Test Plan

- Added `AccumulationCounts - synapse count equals training samples not fan-out`
- Added `AccumulationCounts - neuron bias count equals training samples not fan-out`
- Added `AccumulationCounts - fan-out does not inflate counts vs single output`
- Added `AccumulationCounts - output synapse counts match training samples`
