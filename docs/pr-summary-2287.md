## Summary

Integrate the WASM compilation cache pre-warming module into the evolution
pipeline, so topology hashes are pre-computed and WASM templates are
pre-compiled before fitness evaluation begins. Also fixes pre-existing bugs in
`DeDuplicator.ts` that blocked test execution. Closes #2287.

## Changes

### `src/NEAT/NeatEvolution.ts`

- Calls `preWarmWasmCache(neat.population)` after de-duplication and old
  population disposal, just before the next generation's fitness evaluation.
- Adds `preWarmMs` to the `GenerationPhaseTiming` object.
- Verbose logging includes pre-warm timing and template compilation counts.

### `src/config/TrainingEvent.ts`

- Added optional `preWarmMs` field to `GenerationPhaseTiming`.

### `src/architecture/DeDuplicator.ts` (bug fix)

- Added missing `maxReplacementRetries` property declaration on the class.
- Fixed constructor to reference `DEFAULT_MAX_REPLACEMENT_RETRIES` constant
  instead of undefined `maxReplacementRetries` variable.
- Removed orphaned dead code block referencing undefined `candidateUUIDs` and
  `candidateIndices` variables (leftover from refactor in PR #2291).

### `test/NEAT/DeDuplicatorAsyncOptimisation.ts` (bug fix)

- Fixed `previousExperiment()` calls to use `await` (method is now async).
- Removed invalid third argument to `DeDuplicator` constructor.

### Pre-existing modules (from earlier commit on milestone/speed-up)

- `src/wasm/WasmCachePreWarmer.ts` — `preWarmWasmCache()` function.
- `src/wasm/WasmCompilationCache.ts` — `ensureWasmTemplate()` and
  `hasWasmTemplate()` functions.
- `test/wasm/WasmCachePreWarmer.ts` — 9 tests for the pre-warmer.
- `test/wasm/EnsureWasmTemplate.ts` — 7 tests for template caching.

## Evidence

This is a backend performance change with no visual output. Evidence is
provided via test results:

- All 5823 tests pass (0 failures, 3 ignored).
- 16 pre-warmer/template tests all passing.
- `PreWarmIntegration` test verifies `preWarmMs` appears in generation timing.
- `EvolvePhaseTiming_Extended` tests updated to validate `preWarmMs` field.

## Test Plan

- Added `test/NEAT/PreWarmIntegration.ts`:
  - Verifies `preWarmMs` is reported in `GenerationPhaseTiming` during
    evolution, and is a valid non-negative number when present.
- Updated `test/NEAT/EvolvePhaseTiming_Extended.ts`:
  - Added `preWarmMs` validation alongside other phase timing fields.
  - Added `preWarmMs` to the optional fields type check.
  - Included `preWarmMs` in the total time sum validation.
