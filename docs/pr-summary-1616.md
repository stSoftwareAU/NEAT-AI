## Summary

Expose a cache diagnostics API for performance tuning. Adds a `CacheStats`
interface and a `getCacheStats()` function that returns hit/miss rates, eviction
counts, and size metrics for all instrumented caches (WASM Compilation Cache,
WASM Activation LRU, Distance Cache). Closes #1616.

### Changes

- **`src/cache/CacheStats.ts`** — New `CacheStats` interface with `name`,
  `hits`, `misses`, `evictions`, `currentSize`, and `maxSize` fields
- **`src/cache/getCacheStats.ts`** — Aggregation function that collects stats
  from all instrumented caches
- **`src/wasm/WasmCreatureActivationLRU.ts`** — Added hit/miss/eviction
  counters, `getWasmActivationLruStats()` and `resetWasmActivationLruStats()`
  functions
- **`src/breed/DistanceCache.ts`** — Added eviction counter;
  `getDistanceCacheStats()` now returns `CacheStats`
- **`mod.ts`** — Exports `CacheStats` type, `getCacheStats()`,
  `getWasmActivationLruStats()`, and `resetWasmActivationLruStats()`
- **`src/wasm/mod.ts`** — Re-exports new WASM activation LRU stats functions

### Instrumentation approach

All counters are simple numeric increments — no allocations on hot paths,
negligible overhead. The WASM Compilation Cache already tracked
hits/misses/evictions internally; those are now surfaced through the unified
`CacheStats` interface.

## Evidence

This is a backend/API change with no visual output. Evidence is provided via
passing tests:

- All 4270 tests pass including new cache diagnostics tests
- No performance impact — counters are lightweight increments

## Test Plan

- Added `test/cache/CacheDiagnostics.ts` with tests covering:
  - `getCacheStats()` returns array with all 3 expected caches
  - Each `CacheStats` entry has all required fields with correct types
  - WASM Activation LRU stats track hits, misses, and evictions accurately
  - `resetWasmActivationLruStats()` clears counters without affecting cache
    state
  - Distance Cache stats include evictions and reset on `clearDistanceCache()`
  - Aggregated stats reflect operations performed on individual caches
  - All counters are non-negative
- Updated `test/breed/DistanceCache.ts` to use new `currentSize` field name
- Updated `bench/IncrementalDistanceCache.ts` to use new `currentSize` field
  name
