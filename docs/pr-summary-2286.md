## Summary

Optimise the de-duplication phase by replacing synchronous per-duplicate
`previousExperiment()` file I/O with batched async operations, adding
per-generation caching, and capping the replacement breeding retry loop.
Closes #2286.

## Changes

### Async batch `previousExperiment()` checks

- `DeDuplicator.perform()` is now `async` and batches all `previousExperiment()`
  checks using `Promise.allSettled()` for concurrent file stat operations
- New `asyncPreviousExperiment()` method uses `Deno.stat()` instead of
  `Deno.statSync()`, unblocking the event loop during duplicate detection
- Per-generation `Map<string, boolean>` cache avoids redundant filesystem
  lookups for the same UUID within a single deduplication pass
- Cache is cleared at the start of each `perform()` call

### Capped replacement retries

- Replacement breeding retries now capped at a configurable maximum (default 16,
  previously unbounded up to 48+ attempts)
- Breeding rate boost (`globalBreedingRate = 1`) triggers at half the cap
- When the cap is reached, a warning is logged and the last mutated creature is
  accepted rather than continuing the loop
- Constructor accepts optional `maxReplacementRetries` parameter for tuning

### Other fixes

- Fixed pre-existing duplicate `createdDirs` variable declaration in
  `Neat.ts writeScores()`
- Updated all callers of `perform()` and `populatePopulation()` to `await`

## Evidence

This is a backend performance optimisation with no visual output. Evidence is
provided via test results:

- All 5782 existing tests pass (0 failures, 3 ignored)
- New test file `test/NEAT/DeDuplicatorAsyncOptimisation.ts` verifies:
  - `perform()` returns a Promise and resolves with unique population
  - `previousExperiment()` cache returns consistent results
  - Configurable retry cap is respected (tested with cap of 3)
  - Default retry cap (16) handles many duplicates correctly

## Test Plan

- Added `test/NEAT/DeDuplicatorAsyncOptimisation.ts` with 4 new tests
- All existing de-duplication tests pass unchanged:
  - `test/NEAT/DeDuplicate.ts`
  - `test/NEAT/DeDuplicateBulkRemoval.ts`
  - `test/NEAT/BloomFilterDeDuplication.ts`
  - `test/NEAT/SinglePassDeDuplication.ts`
  - `test/NEAT/EarlyDeDuplication.ts`
- All `populatePopulation()` tests pass with async changes
- Full quality gate (`quality.sh`) passes cleanly
