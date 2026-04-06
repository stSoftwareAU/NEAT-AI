## Summary

Replace the arbitrary sequential neuron mapping in `editParentByIndex` with
input-weight cosine similarity alignment for inter-species breeding. When
breeding creatures from different islands with no shared neuron UUIDs and no
matching connectivity keys, neurons are now aligned by functional role — neurons
with similar input weight patterns are mapped together. Falls back to sequential
mapping for neurons with no meaningful input connections. Closes #2174.

## Changes

- **`src/breed/NeuronSimilarity.ts`** (new): Cosine similarity module with
  `buildInputWeightVector`, `cosineSimilarity`, and `computeSimilarityAlignment`
  functions implementing greedy best-match alignment.
- **`src/breed/EditParentByIndex.ts`**: Replaced sequential `parentIndx` loop
  with similarity-based alignment followed by sequential fallback for remaining
  unmatched neurons.

## Evidence

- The key integration test (`EditParentByIndexSimilarity.ts`) verifies that
  neurons are aligned by functional similarity, not sequential position:
  target-Y (strong input-1) maps to parent-B (strong input-1), not parent-A.
- All 5300 existing tests continue to pass with zero failures.

## Test Plan

- `test/breed/NeuronSimilarity.ts` — 11 unit tests for the similarity module:
  - Input weight vector construction
  - Cosine similarity: identical, orthogonal, opposite, empty, proportional vectors
  - Similarity alignment: correct matching, orthogonal fallback, empty lists,
    asymmetric neuron counts
- `test/breed/EditParentByIndexSimilarity.ts` — 3 integration tests:
  - Similarity-based alignment maps functionally similar neurons correctly
  - Falls back gracefully when no similarity exists
  - Produces valid exportable creatures after similarity alignment
- `test/breed/EditParentByIndex.ts` — All 11 existing tests continue to pass
