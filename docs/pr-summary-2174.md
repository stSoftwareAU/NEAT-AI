## Summary

Improved neuron alignment in inter-species breeding by replacing the sequential
positional mapping in `editParentByIndex` with input-weight cosine
similarity-based alignment. Closes #2174.

When breeding creatures from different islands, UUID matching and connectivity
key matching both fail completely due to different neuron ID formats and
drastically different topologies. Previously, the sequential fallback in
`editParentByIndex` mapped father neurons to mother neurons by array position,
which has no semantic meaning.

Now, unmatched hidden neurons are compared by their incoming weight vectors from
shared input neurons using cosine similarity. A greedy best-match algorithm
picks the highest-similarity pairs first, ensuring neurons with similar
functional roles are aligned. Neurons without meaningful input connections
(e.g., deep hidden neurons) fall back to the original sequential mapping.

### New files

- `src/breed/NeuronAlignment.ts` — input-weight vector construction, cosine
  similarity computation, and greedy similarity-based alignment algorithm
- `test/breed/NeuronAlignment.ts` — 14 tests covering unit and integration
  scenarios

### Modified files

- `src/breed/EditParentByIndex.ts` — integrated similarity-based alignment
  before the sequential fallback

## Evidence

All 5300 existing tests pass, confirming no regressions. The new tests
specifically verify that:

- Neurons with reversed functional order are correctly aligned by similarity
  (not sequential position)
- Asymmetric creature sizes are handled correctly
- Deep neurons without input connections fall back gracefully

## Test Plan

- `test/breed/NeuronAlignment.ts` — 14 new tests:
  - 3 unit tests for `buildInputWeightVector`
  - 5 unit tests for `cosineSimilarity`
  - 3 unit tests for `computeSimilarityAlignment`
  - 3 integration tests for `editParentByIndex` with similarity alignment
- `test/breed/EditParentByIndex.ts` — all 11 existing tests continue to pass
