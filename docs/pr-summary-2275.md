## Summary

Reduce synchronous disk I/O in the evolution loop by converting `writeScores`
and `writeCreatures` from synchronous to async I/O with batched `Promise.all`
writes. Closes #2275.

### Changes

- **`writeScores` (Neat.ts)**: Converted from `Deno.writeTextFileSync` to async
  `Deno.writeTextFile` with `Promise.all` batching. Added a `Set<string>` cache
  for directory creation to skip redundant `ensureDirSync` calls.
- **`writeCreatures` (CreatureTraining.ts)**: Converted from
  `Deno.writeTextFileSync` to async `Deno.writeTextFile` with `Promise.all`
  batching. Switched from pretty-printed `JSON.stringify(json, null, 1)` to
  compact `JSON.stringify(json)` — benchmarks showed 2.4x faster serialisation.
- **Call sites**: Updated `NeatEvolution.ts` and `CreatureTraining.ts` to
  `await` the now-async functions.
- **ExperimentStore test**: Updated to `await` the async `writeScores`.

## Evidence

### Benchmark results (Apple M4 Pro, Deno 2.7.12)

**writeScores** — async + cached dirs vs sync baseline:

| Population | Sync (baseline) | Async + cached dirs | Speedup |
|------------|-----------------|---------------------|---------|
| 100        | 4.8 ms          | 3.5 ms              | 1.38x   |
| 300        | 16.2 ms         | 13.0 ms             | 1.25x   |
| 500        | 26.5 ms         | 21.5 ms             | 1.23x   |

**Checkpoint writing** — async + compact JSON vs sync + pretty-print baseline:

| Population | Sync + pretty (baseline) | Async + compact | Speedup |
|------------|--------------------------|-----------------|---------|
| 100        | 13.0 ms                  | 9.8 ms          | 1.32x   |
| 300        | 48.4 ms                  | 31.4 ms         | 1.54x   |

**JSON.stringify** — compact vs pretty-print:

| Population | Pretty-print | Compact | Speedup |
|------------|-------------|---------|---------|
| 100        | 1.3 ms      | 540 µs  | 2.42x   |

All improvements exceed the >5% threshold specified in the issue.

## Test Plan

- Added `test/NEAT/AsyncDiskIO.ts` (7 tests):
  - Async writeScores writes correct score files
  - Multiple creatures handled correctly
  - Skips when no experimentStore configured
  - Overwrites existing score files
  - Directory creation cache works across creatures
  - Compact JSON checkpoint round-trips correctly
  - Compact vs pretty JSON parse to identical objects
- Updated `test/NEAT/ExperimentStore.ts` to await async `writeScores`
- Added `bench/DiskIOEvolutionLoop.ts` benchmark comparing sync vs async vs
  batched approaches for writeScores and checkpoint writing
- All 5758 existing tests pass
