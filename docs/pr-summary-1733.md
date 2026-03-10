## Summary

Add `getSuccessfulRemovalDetails()` to the success cache, returning structured
`SuccessfulRemovalDetail` records (neuronUUID, scoreDelta, candidateScore,
originalScore, timestamp) for each unique successfully-removed neuron. This
enables cache-informed combination builders to prioritise high-impact neuron
removals when constructing multi-neuron removal candidates. Closes #1733.

The existing `getSuccessfulRemovalNeuronUUIDs()` is unchanged and continues to
serve the deprioritisation/filtering use case.

## Evidence

- All 4669 tests pass (including 8 new tests for `getSuccessfulRemovalDetails`)
- `quality.sh` passes cleanly (format, lint, type-check, all tests)
- Existing `getSuccessfulRemovalNeuronUUIDs` tests unchanged and passing

## Test Plan

New test file `test/discovery/SuccessCacheRemovalDetails.ts` with 8 tests:

- Returns empty array for non-existent directory
- Returns empty array for empty directory
- Returns structured data (UUID, scoreDelta, candidateScore, originalScore,
  timestamp)
- Ignores non-removal entries (add-synapses, change-squash)
- Deduplicates same neuron across directories, keeping best score delta
- Skips corrupt entries gracefully
- Handles missing metadata fields gracefully (defaults to 0/"")
- Skips entries without neuron UUID (missing or empty)
