## Summary

Lower Phase 2 combination threshold from 2 to 1 successful Phase 1 single. When only 1 Phase 1 single candidate succeeds, supplement with historically successful candidates from the success cache to enable combination building. This means combinations are tried even with fewer Phase 1 successes, by leveraging prior discovery knowledge. Closes #1734.

### Changes

- **`src/discovery/SupplementFromCache.ts`** (new): Module that loads historical success cache entries, validates them against the current creature (neuron/synapse existence checks), filters out already-applied and duplicate entries, and reconstructs `DiscoveryCandidate` objects for combination building.
- **`src/discovery/DiscoveryRunner.ts`**: Lowered Phase 2 gate from `successfulSingles.length >= 2` to `>= 1`. When fewer than 2 Phase 1 successes exist, calls `supplementFromCache()` to augment the candidate pool before building combinations.
- Existing behaviour is unchanged when 2+ Phase 1 successes exist — supplementation is only triggered when fewer than 2 Phase 1 singles succeed.

## Evidence

- All 4649 tests pass (0 failures)
- `./quality.sh` passes cleanly (lint, format, type-check, all tests)
- Integration test verifies combo-successful candidates are produced when 1 Phase 1 success is supplemented by cache data
- Existing DiscoveryRunner tests confirm no regressions for the 2+ successes path

## Test Plan

- `test/discovery/SupplementFromCache.ts` — 9 unit tests for the supplementation module:
  - Returns empty when no cache dir or empty cache
  - Returns valid candidates from cache
  - Skips already-applied entries
  - Skips entries referencing non-existent neurons
  - Excludes duplicates of existing Phase 1 successes
  - Respects maxSupplements limit
  - Sorts by scoreDelta descending (best historical performers first)
  - Skips combo entries from cache
- `test/discovery/DiscoveryRunnerCacheSupplement.ts` — 3 integration tests:
  - Phase 2 triggers with 1 successful single when cache supplements available
  - Phase 2 unchanged when 2+ Phase 1 successes exist
  - Phase 2 skipped when 0 Phase 1 successes and no cache
