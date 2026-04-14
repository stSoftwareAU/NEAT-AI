## Summary

Pre-warm the WASM compilation cache before fitness evaluation by pre-computing
topology hashes and pre-compiling WASM templates for unique topologies after
breeding, mutation, and de-duplication. This reduces cold-start compilation
overhead during the fitness evaluation phase. Closes #2287.

## Changes

### New module: `src/wasm/WasmCachePreWarmer.ts`
- `preWarmWasmCache(creatures)` iterates the population, skipping creatures
  that already have scores (elitists/trained), pre-computes topology hashes on
  each unevaluated creature, identifies unique topologies, and ensures a WASM
  template is cached for each.
- Returns a `PreWarmResult` with diagnostic counters (total creatures,
  unevaluated count, unique topologies, new templates compiled, cache hits,
  ineligible creatures, elapsed time).

### `src/wasm/WasmCompilationCache.ts`
- Added `ensureTemplate(creature)` — builds and caches the topology template
  without creating a full `WasmCreatureActivation`, avoiding unnecessary
  weight compilation overhead.
- Added `hasTemplate(topologyHash)` — O(1) cache presence check.
- Both methods are exported for use by the pre-warmer and tests.

### `src/NEAT/NeatEvolution.ts`
- Calls `preWarmWasmCache(neat.population)` after de-duplication and before
  old population disposal, so the next generation's fitness evaluation starts
  with a warm cache.
- Adds `preWarmMs` to per-generation timing diagnostics.
- Verbose logging includes pre-warm timing and template compilation counts.

### `src/config/TrainingEvent.ts`
- Added optional `preWarmMs` field to `GenerationPhaseTiming`.

## Evidence

This is a backend performance change with no visual output. Evidence is
provided via test results:

- 16 new tests across 2 test files all passing:
  - `test/wasm/EnsureWasmTemplate.ts` (7 tests) — verifies template caching,
    cache presence checks, and interaction with `getOrCompile`.
  - `test/wasm/WasmCachePreWarmer.ts` (9 tests) — verifies population
    pre-warming, topology deduplication, score-based skipping, empty
    populations, and LRU eviction behaviour.
- All 12 existing `WasmCompilationCache` tests continue to pass.
- All 3 `EvolvePhaseTiming_Extended` tests continue to pass.

## Test Plan

- Added `test/wasm/EnsureWasmTemplate.ts`:
  - Verifies `ensureWasmTemplate` caches template on first call
  - Verifies `ensureWasmTemplate` returns true for already-cached topology
  - Verifies `hasWasmTemplate` returns false for uncached topology
  - Verifies `hasWasmTemplate` returns true after `ensureWasmTemplate`
  - Verifies no `cachedWasmActivation` is created on the creature
  - Verifies subsequent `getOrCompile` is a cache hit (not a miss)
  - Verifies topology hash is pre-computed on the creature
- Added `test/wasm/WasmCachePreWarmer.ts`:
  - Verifies topology hashes are pre-computed for all unevaluated creatures
  - Verifies WASM templates are pre-compiled for unique topologies
  - Verifies already-cached topologies are not recompiled
  - Verifies creatures with scores are skipped
  - Verifies empty population is handled gracefully
  - Verifies all-scored population is handled gracefully
  - Verifies cache eviction behaviour under small cache sizes
  - Verifies topology hashes are reusable after pre-warming
  - Verifies multiple creatures with same topology only compile once
