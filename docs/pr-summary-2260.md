## Summary

Cache dataset file metadata in workers across `evaluateDir` calls to avoid
repeated `Deno.readDirSync` directory scans. Closes #2260.

Each worker `evaluate` call previously scanned the dataset directory via
`dataFiles()` on every invocation. Since workers are long-lived and the dataset
directory is stable, this introduces a `DatasetFileListCache` that memoises the
sorted file list and returns it from memory on subsequent calls.

## Changes

- **`src/architecture/DatasetFileListCache.ts`** (new): Worker-local cache for
  the sorted list of `.bin` files in a dataset directory.
- **`src/multithreading/workers/WorkerProcessor.ts`**: Uses
  `DatasetFileListCache` to pass a cached file list to `evaluateDir`.
- **`src/creature/CreatureActivation.ts`**: `evaluateDir` accepts an optional
  `cachedFiles` parameter; falls back to `dataFiles()` when not provided.
- **`src/Creature.ts`**: Pass-through of `cachedFiles` parameter.

## Evidence — Benchmark Results

```
benchmark                                               | time/iter (avg) | iter/s
dataFiles() — uncached directory scan (50 files)        |         42.7 µs |  23,430
DatasetFileListCache.getFiles() — cached (50 files)     |          4.0 ns | 250,500,000

summary
  dataFiles() — uncached directory scan (50 files)
    10690x slower than DatasetFileListCache.getFiles() — cached (50 files)
```

The cached lookup is **~10,700x faster** than the uncached directory scan (4 ns
vs 42.7 µs per call). In a worker processing thousands of creatures per
generation, this eliminates a measurable per-evaluation overhead.

## Test Plan

- Added `test/architecture/DatasetFileListCache.ts` with 4 tests:
  - Correct file discovery from a real dataset directory
  - Cache returns same array reference on repeated calls
  - `clear()` forces a fresh directory re-scan
  - Directory change invalidates the cache
- Added `bench/DatasetFileListCache.ts` for reproducible benchmarking
- All 5732 existing tests continue to pass
