## Summary

Optimise the de-duplication phase by replacing synchronous per-duplicate
`previousExperiment()` file I/O with batched async operations, adding
per-generation caching, and capping the replacement breeding retry loop.
Closes #2286.

### Changes

- **Async `previousExperiment()`**: Replaced `Deno.statSync()` with async
  `Deno.stat()` to avoid blocking the event loop during duplicate detection.
- **Batched checks**: Non-duplicate candidates are collected during Pass 2 and
  their `previousExperiment()` checks are run in parallel via
  `Promise.allSettled()`.
- **Per-generation cache**: A `Map<string, boolean>` caches
  `previousExperiment()` results within each de-duplication pass, eliminating
  redundant filesystem lookups for the same UUID.
- **Capped retries**: The replacement breeding retry loop is now bounded by
  `maxDedupRetries` (default 16, previously unbounded up to 48+). When the cap
  is reached, the mutated duplicate is accepted rather than being spliced out,
  preserving population size.
- **Warning on cap**: A warning is logged when the retry cap is hit, surfacing
  de-duplication pressure issues.
- **Configurable**: New `maxDedupRetries` option in `NeatArguments`/`NeatConfig`/
  `NeatOptions` (integer, min 1, default 16).
- **Bug fix**: Removed pre-existing duplicate `createdDirs` declaration in
  `Neat.ts`.

## Evidence

This is a backend performance optimisation with no UI changes. Evidence is
provided by the test suite:

- All 5782 existing tests pass (0 failed, 3 ignored).
- New test file `test/NEAT/DeDuplicateRetryCap.ts` with 4 tests verifying:
  - Retry cap preserves population size under duplication pressure
  - Default `maxDedupRetries` is 16
  - Async `perform()` produces unique creatures
  - `previousExperiment()` caching behaviour

## Test Plan

- Added `test/NEAT/DeDuplicateRetryCap.ts` (4 new tests)
- Updated 27 existing files to use `await` with the now-async `perform()` and
  `populatePopulation()` methods
- All existing de-duplication tests continue to pass unchanged
