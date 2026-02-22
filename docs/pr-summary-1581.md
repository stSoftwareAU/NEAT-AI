## Summary

Ensure WASM LRU cache eviction fully frees CompiledNetwork linear memory. Closes #1581.

The WASM creature activation LRU cache had three issues causing memory leaks during long-running workloads:

1. **`WasmCreatureActivation.free()` did not nullify `this.network`** — after calling `.free()` on the WASM compiled network, the JS wrapper still retained a reference to the freed object, preventing the underlying `WebAssembly.Instance` and its linear memory `ArrayBuffer` from being garbage collected.

2. **Manual `disposeWasm()` did not deregister from the LRU cache** — when a creature was manually disposed (e.g., via `creature.dispose()`), its LRU node remained in the cache, artificially inflating the cache count against the cap and causing premature eviction of other entries.

3. **No bulk cleanup API existed** — there was no way to flush all cached WASM activations at once for use between training runs/prefixes.

### Changes

- `WasmCreatureActivation.free()` now sets `this.network = undefined` after calling `.free()`, ensuring the WASM instance and its linear memory become GC-eligible
- `disposeWasm()` now calls `deregisterWasmCreatureActivation()` to remove the creature from the LRU cache
- Added `disposeAllCachedWasmActivations(): number` — flushes the entire WASM LRU cache, returning the number of entries disposed
- Added `deregisterWasmCreatureActivation(creature)` — removes a creature from the LRU cache without calling disposeWasm (for use when the caller has already disposed)
- Both new functions are exported from `mod.ts` for downstream use (e.g., GRQ between training prefixes)

## Evidence

This is a backend/memory-management fix with no UI changes. Evidence is provided by the test suite:

- All 4342 tests pass, including 7 new tests specifically for the disposal and deregistration behaviour
- Tests verify activate/dispose/re-activate cycles work correctly with real WASM activations
- Tests verify `disposeAllCachedWasmActivations()` clears all entries and calls `disposeWasm()` on each
- Tests verify `deregisterWasmCreatureActivation()` reduces the cache count
- Tests verify that `creature.dispose()` now deregisters from the LRU cache

## Test Plan

- `test/wasm/WasmCreatureActivationLRU.ts`:
  - `disposeAll returns 0 on empty cache`
  - `disposeAll flushes all entries and calls disposeWasm`
  - `disposeAll is idempotent`
  - `deregister removes creature from cache count`
  - `deregister for unknown creature is a no-op`
  - `dispose() deregisters from LRU via disposeWasm`
  - `disposeWasm is idempotent after manual call`
- `test/wasm/WasmDisposal.ts`:
  - `activate, dispose, re-activate cycle works` (real WASM)
  - `disposeAll frees real WASM activations` (real WASM)
  - `LRU eviction frees WASM and allows re-activation` (real WASM)
