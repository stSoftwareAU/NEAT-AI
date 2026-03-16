## Summary

Add `getSuccessfulRemovalNeuronUUIDs()` function to
`src/discovery/SuccessCache.ts` that queries the success cache for neuron UUIDs
already proven successful for removal. This scans the `remove-low-impact` and
`remove-neuron` subdirectories, extracting neuron UUIDs from
`rustRequest.removalCandidate.neuronUUID` and
`rustRequest.harmfulNeuronCandidate.neuronUUID`. The function provides the
foundation for deprioritising redundant removal candidates across discovery
rounds. Closes #1715.

## Evidence

This is a backend/utility function with no visual output. Correctness is
verified by the unit tests below. All 4573+ tests pass (the only failure is a
pre-existing flaky `MutatorBehavioural` test unrelated to this change).

## Test Plan

Added 6 unit tests in `test/discovery/SuccessCache.ts`:

- Empty set returned for non-existent directory
- Empty set returned for empty directory
- Correct neuron UUIDs extracted from `remove-low-impact` and `remove-neuron`
  entries
- Non-removal entries (e.g., `add-synapses`, `change-squash`) are ignored
- Corrupt JSON entries are skipped gracefully with a warning
- Same neuron UUID across both removal directories is deduplicated
