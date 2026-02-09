## Summary

Cache the outgoing synapse map used by `calculatePathsToOutput()` during sparse training, avoiding redundant O(synapses) map construction. Also applies the index pointer BFS optimisation (from Issue #1030) to the path calculation.

### Changes

- **`src/propagate/sparse/CalculatePathsToOutput.ts`**: Extracted `buildOutgoingSynapsesMap()` as a public function and added `OutgoingSynapsesMap` type. The function accepts an optional pre-built map to skip internal map construction. BFS now uses an index pointer instead of `Array.shift()`.
- **`src/propagate/sparse/SparseConfig.ts`**: Constructor accepts an optional `OutgoingSynapsesMap` parameter, passed through to `calculatePathsToOutput()`.
- **`src/architecture/Training.ts`**: Builds the outgoing synapse map once before constructing `SparseConfig`.
- **`src/Creature.ts`**: Same pattern applied in `traceDir()`.

## Evidence

### Benchmark Results (561 neurons, 13,905 synapses)

**`calculatePathsToOutput` isolated:**

| Metric | Uncached | Cached | Improvement |
|--------|----------|--------|-------------|
| Average per call | 145.7µs | 1.4µs | **99.0%** |

**`SparseConfig` construction (includes `chooseNeurons` + `calculatePathsToOutput`):**

| sparseRatio | Uncached | Cached | Improvement |
|-------------|----------|--------|-------------|
| 0.05 | 403µs | 245µs | **39.3%** |
| 0.1 | 387µs | 246µs | **36.3%** |
| 0.3 | 433µs | 238µs | **44.9%** |
| 0.5 | 393µs | 241µs | **38.8%** |
| 1.0 | 165µs | 27µs | **83.8%** |

**Breakdown**: Map building accounted for ~98% of `calculatePathsToOutput` runtime. By extracting and caching it, the path calculation itself drops to ~1.4µs (BFS only).

This is a backend/CLI change with no visual component. Performance was validated via dedicated benchmarks in `bench/sparse/`.

## Test Plan

- Added `test/propagate/sparse/OutgoingSynapsesMap.ts` (5 tests):
  - `buildOutgoingSynapsesMap` groups synapses by fromUUID
  - `calculatePathsToOutput` with cached map matches uncached
  - `calculatePathsToOutput` with cached map finds correct paths
  - `buildOutgoingSynapsesMap` handles creature with no synapses
  - `calculatePathsToOutput` with cached map handles isolated neurons
- Added `test/propagate/sparse/PathCache.ts` (2 tests):
  - `SparseConfig` with cached outgoing map produces consistent results
  - `SparseConfig` cached outgoing map reusable across multiple configs
- All 2,173 existing tests continue to pass
- Added benchmarks: `bench/sparse/PathToOutputCache.ts`, `bench/sparse/PathToOutputCacheDetailed.ts`
