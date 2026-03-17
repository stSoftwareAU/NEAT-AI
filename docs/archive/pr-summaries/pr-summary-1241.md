## Summary

Final WASM migration cleanup: removed the last remaining WASM feature flag
(`NEAT_AI_USE_WASM_BACKPROP` environment variable) and its associated
conditional logic (`shouldUseWasmBackprop()`, `resetWasmBackpropFlag()`).

WASM is now the unconditional activation and backpropagation backend with no
opt-out. The only JS code paths that remain are:

- **StdInverse**: requires f64 precision (WASM returns f32, which introduces
  kilounit rounding errors at extreme values)
- **Unsupported squash functions**: graceful fallback for any squash not yet
  implemented in the WASM module
- **Metadata providers**: JS activation classes still supply `range`,
  `mutationProbability`, and other metadata used by evolution and validation

### Changes

- **`src/wasm/ActivationMethods.ts`**: Removed `shouldUseWasmBackprop()`,
  `resetWasmBackpropFlag()`, and the `NEAT_AI_USE_WASM_BACKPROP` environment
  variable check. All four wrapper functions (`calculateError`,
  `safeZoneAdjustment`, `unSquash`, `squash`) now use
  `isWasmActivationAvailable()` directly.
- **`src/wasm/mod.ts`**: Removed exports of `shouldUseWasmBackprop` and
  `resetWasmBackpropFlag`.
- **`test/WasmBackpropagation.ts`**: Removed the `shouldUseWasmBackprop flag`
  test and updated imports.
- **`test/wasm/NoWasmFeatureFlags.ts`** (new): Verifies that WASM activation is
  unconditionally available, old toggle functions are no longer exported, and
  all standard squash functions are WASM-supported.

## Evidence

Unable to generate screenshot: this is a CLI-only neural network library with no
visual interface.

## Test Plan

- Added `test/wasm/NoWasmFeatureFlags.ts` with three tests:
  - `No WASM feature flags: WASM activation is unconditionally available`
  - `No WASM feature flags: shouldUseWasmBackprop is no longer exported`
  - `No WASM feature flags: all standard squash functions are WASM-supported`
- Existing `test/WasmBackpropagation.ts` updated (removed obsolete toggle test)
- Existing `test/wasm/WasmOnlyActivation.ts` continues to verify all activation
  functions work through WASM
- All 1737 tests pass via `./quality.sh`
