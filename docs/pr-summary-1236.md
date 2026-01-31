## Summary

Remove the `useJs` parameter from all activation method wrapper functions and
eliminate JS activation fallback paths (#1236).

### Changes

- **`src/wasm/ActivationMethods.ts`**: Removed `useJs` parameter from
  `calculateError()`, `safeZoneAdjustment()`, `unSquash()`, and `squash()`. All
  four functions now unconditionally delegate to WASM when available. The
  `StdInverse` special case (which requires f64 precision to avoid kilounit
  rounding errors) now calls the JS implementation directly instead of setting a
  `useJs` flag.

- **`src/Creature.ts`**: Removed stale `@param useJs` JSDoc entries from
  `activate()` and `activateAndTrace()` (the parameter was already removed from
  the signatures in a prior PR).

- **`src/compact/CompactUtils.ts`**: Replaced `wasmSquash(name, value, true)`
  call with a direct `Activations.find(name).squash(value)` call. This preserves
  the f64 precision required for deterministic structural rewrites without
  depending on the removed `useJs` parameter.

- **`test/WasmBackpropagation.ts`**: Converted WASM-vs-JS equivalence tests to
  WASM-only correctness tests. Tests now verify that WASM produces finite,
  correct results against known reference values rather than comparing WASM and
  JS paths.

- **`test/score/WasmJsScoreParity.ts`**: Updated file-level comment to reflect
  WASM-only scoring (removed stale `useJs=true` reference).

### What was NOT changed

- `NEAT_AI_USE_JS_ACTIVATION` environment variable was already absent from the
  codebase.
- `NEAT_AI_USE_WASM_BACKPROP` debug-only environment variable is retained
  (separate concern; used for backpropagation debugging, not activation).
- Historical PR summary docs (`pr-summary-1118.md`, `pr-summary-1122.md`) are
  left unchanged as they document prior migration phases.

## Evidence

Unable to generate screenshot: This is a CLI-only library with no visual
interface.

## Test Plan

- All 1735 existing tests pass with `./quality.sh`
- Updated `test/WasmBackpropagation.ts` — converted 5 WASM-vs-JS comparison
  tests to WASM-only correctness tests:
  - `squash function produces correct results` — verifies against known values
  - `unSquash function produces correct results` — verifies round-trip
  - `calculateError function produces finite results` — verifies non-zero error
  - `safeZoneAdjustment function produces valid results` — verifies [0,1] range
  - `All standard squash functions work with WASM wrapper` — all 31 squashes
- Updated `test/score/WasmJsScoreParity.ts` — comment-only update
- Existing `test/wasm/WasmOnlyActivation.ts` continues to pass unchanged
