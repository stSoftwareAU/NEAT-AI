## Summary

Build multi-neuron removal candidates from the success cache in Phase 1
discovery. Closes #1731.

Previously, the success cache data for neuron removals was only used for
deprioritisation in filtering. This enhancement proactively builds candidates
that remove combinations of 2-3 neurons that have individually succeeded in past
discovery runs, adding them to Phase 1 evaluation rather than waiting for
Phase 2.

### Changes

- **New module** `src/discovery/CacheInformedRemovalCandidates.ts`:
  `buildCacheInformedRemovalCandidates()` queries
  `getSuccessfulRemovalDetails()`, filters to neurons still present in the
  creature, and builds pair/triple removal combinations using seeded RNG for
  reproducible sampling
- **New change type** `cache-informed-removal` added to `DiscoveryChangeType`
- **Pipeline integration**: Called from `buildDiscoveryCandidates()` with the
  success cache directory passed through `BuildDiscoveryCandidatesOptions`
- **Failure cache**: `FailureCacheKey.ts` handles the new type using structural
  signatures
- **Candidate application**: `CandidateApplication.ts` routes the new type
  through `applyRemoveNeuron()`
- **Filtering/descriptions**: `CandidateFiltering.ts`,
  `CandidateDescriptions.ts`, and `CombinedFromSuccessful.ts` updated to
  recognise the new type as a removal type

## Evidence

All 4679 tests pass (0 failures). The new builder function:

- Returns empty arrays for missing/empty caches or insufficient matching neurons
- Builds pair candidates from 2 cached neurons
- Builds pair + triple candidates from 3+ cached neurons
- Filters to neurons that still exist in the creature
- Produces reproducible results with the same seed
- All candidates have the correct `cache-informed-removal` type

## Test Plan

- Added `test/discovery/CacheInformedRemovalCandidates.ts` with 10 test cases:
  - Empty/missing cache returns no candidates
  - Non-existent cache directory returns no candidates
  - Single neuron in cache returns no candidates (need 2+)
  - Non-existent neurons filtered out
  - Pair combinations built from 2 cached neurons
  - Pair + triple combinations from 3 cached neurons
  - Filtering to neurons existing in creature
  - Seeded RNG reproducibility
  - Correct change type on all candidates
