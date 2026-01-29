## Summary

Fixed issue #1247: "WASM activation is required but not initialised" error when
calling `scoreDir()` or `evaluateDir()` without explicit WASM initialisation.

The root cause was that `evaluateDir()` and `scoreDir()` called
`requireWasmOrThrow()` which simply threw if WASM was not yet initialised,
unlike the discovery path which had `ensureWasmActivationForDiscovery()` to
auto-initialise. When the module-level auto-init failed silently (e.g. in
workers, JSR downloads, or permission-restricted environments), users received
a confusing error with no automatic recovery.

### Changes

- **Created `src/wasm/EnsureWasmActivation.ts`**: A shared helper
  (`ensureWasmActivation()`) that auto-initialises WASM from the default path,
  reusable by both scoring and discovery code paths.
- **Made `evaluateDir()` and `scoreDir()` async**: These methods now call
  `await ensureWasmActivation()` before `requireWasmOrThrow()`, ensuring WASM is
  initialised automatically when needed.
- **Updated all callers** to `await` the now-async methods:
  - `ImproveSquash.combineImprovements()` (now async)
  - `TacitKnowledge.applyNeuronChanges()` (now async)
  - Both `WorkerProcessor.ts` files (already async, just added `await`)
- **Refactored `DiscoverDirectory.ts`**: `ensureWasmActivationForDiscovery()`
  now delegates to the shared `ensureWasmActivation()` helper, and
  `getWasmDefaultPath()` is re-exported from the shared module for backward
  compatibility.
- **Updated test stubs**: All test files that stubbed `scoreDir()` now return
  `Promise.resolve(...)` and use async operations.

## Evidence

Unable to generate screenshot: This is a CLI library with no visual interface.

## Test Plan

- Added `test/score/WasmInitialisationBeforeScoring.ts` with four tests:
  - `Issue #1247: ensureWasmActivation initialises WASM when not available`
  - `Issue #1247: ensureWasmActivation is idempotent`
  - `Issue #1247: scoreDir auto-initialises WASM and returns valid score`
  - `Issue #1247: evaluateDir auto-initialises WASM and returns valid error`
- All 1823 existing tests continue to pass with no modifications to test logic.
