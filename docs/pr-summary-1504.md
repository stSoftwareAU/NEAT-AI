## Summary

Reduce WASM CompiledNetwork memory retention for data-generation workloads. Closes #1504.

Adds `creature.activateSingleUse(input)` — a drop-in replacement for `activate()` that
automatically disposes the cached WASM `CompiledNetwork` after each call. This prevents
WASM heap accumulation in workloads where each creature is activated once or rarely.

Also exports WASM cache management functions (`setMaxCachedWasmCreatureActivations`,
`getMaxCachedWasmCreatureActivations`, `getCachedWasmActivationCount`) from the main
`mod.ts` so data-gen workloads can tune the LRU cache cap (recommended: 64–128) or
monitor cache pressure without importing internal modules.

### Changes

- **`src/Creature.ts`**: Added `activateSingleUse(input, feedbackLoop?)` method that
  calls `activate()` then `disposeWasm()` in a `try/finally` block
- **`src/wasm/WasmCreatureActivationLRU.ts`**: Added `getCachedWasmActivationCount()`
  for observability of current cache size
- **`src/wasm/mod.ts`**: Exported `getCachedWasmActivationCount`
- **`mod.ts`**: Exported cache management functions with documentation for data-gen usage

## Evidence

This is a backend/API change with no visual output. Verified via unit tests:

- 7 new tests in `test/wasm/SingleUseWasmActivation.ts` all pass
- 11 existing tests in `test/wasm/WasmCreatureActivationLRU.ts` continue to pass
- Full test suite (3865 tests) passes; one pre-existing flaky test (`evolve_Bigger_than`)
  fails intermittently under parallel resource contention but passes in isolation

## Test Plan

- `test/wasm/SingleUseWasmActivation.ts` — 7 new tests:
  - `getCachedWasmActivationCount` returns a number
  - `getCachedWasmActivationCount` increases after `activate()`
  - `activateSingleUse` disposes WASM after activation
  - `activateSingleUse` produces same results as `activate()`
  - Multiple sequential single-use activations work
  - `activateSingleUse` with `feedbackLoop` parameter
  - `activateSingleUse` validates input and cleans up on error
