## Summary

O(1) LRU eviction and buffer pooling in WasmCompilationCache. Closes #1539.

Two performance improvements to `src/wasm/WasmCompilationCache.ts`:

1. **O(1) LRU eviction**: Replaced the O(n) linear scan in `evictLRU()` with a doubly-linked list + Map structure (same pattern as `WasmCreatureActivationLRU` from #1534). Eviction, promotion, and removal are all O(1).

2. **Buffer pooling**: Instead of calling `.slice()` on every cache hit to copy the template buffer, each topology entry now maintains a small pool (up to 4) of reusable `Uint8Array` work buffers. When a buffer is no longer needed by WASM instantiation, it can be returned to the pool for reuse.

## Evidence

### Benchmark Results

| Benchmark | Before (µs) | After (µs) | Improvement |
|---|---|---|---|
| Cached compilation - same topology | 152.9 | 137.6 | **10% faster** |
| Cached compilation - different topologies | 232.6 | 211.6 | **9% faster** |
| Full activation cycle - same topology | 226.4 | 210.1 | **7% faster** |
| Full activation cycle - different topologies | 321.7 | 298.3 | **7% faster** |

Run with: `deno bench --allow-all bench/WasmCompilationCache.ts`

## Test Plan

- All 9 existing `WasmCompilationCache` tests continue to pass unchanged
- Added 3 new tests:
  - **LRU evicts correct entry after access reorder**: Verifies that re-accessing an entry promotes it, causing a different (correct) entry to be evicted
  - **Repeated hits produce correct activation results**: Verifies that buffer pooling does not corrupt activation outputs across multiple cache hits
  - **Reducing cache size triggers correct evictions**: Verifies that `setMaxSize()` triggers the correct number of evictions
- All 4167 project tests pass
