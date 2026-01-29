## Summary

Fixed issue #1206 where `WorkerHandler` would throw an `AssertionError` with
message "WASM activation payload missing. Build `wasm_activation/pkg` first."
when the WASM activation files were not built.

The fix makes WASM activation optional. When the WASM files
(`wasm_activation/pkg/wasm_activation.js` and
`wasm_activation/pkg/wasm_activation_bg.wasm`) are not available, the library
returns `null` from `loadWasmActivationInitPayload()`.

> **Note:** Issue #1229 changes the default behaviour: WASM is now required on
> the default path. When the payload is `null` and `NEAT_AI_USE_JS_ACTIVATION`
> is not set, workers will fail rather than falling back to JavaScript. Set
> `NEAT_AI_USE_JS_ACTIVATION=1` for verification or optional-WASM mode only.

This is important for:

1. **Library consumers** - Users who install the library from JSR should build
   the WASM module or set `NEAT_AI_USE_JS_ACTIVATION=1` for verification
2. **Development environments** - Developers working on non-WASM parts of the
   codebase can set `NEAT_AI_USE_JS_ACTIVATION=1` to run tests without WASM
3. **CI/CD pipelines** - Build pipelines that don't include the Rust/WASM
   toolchain can set `NEAT_AI_USE_JS_ACTIVATION=1` for verification

### Changes

- Modified `loadWasmActivationInitPayload()` to accept an optional `wasmPath`
  parameter and exported it for external use
- Added new `isWasmActivationPayloadAvailable()` function to check WASM
  availability without loading the full payload
- Updated `WorkerHandler` constructor to use the non-throwing version, passing
  `undefined` for `wasmActivation` when files are missing
- Removed the `loadWasmActivationInitPayloadOrThrow()` function that caused the
  crash

## Evidence

Unable to generate screenshot: This is a CLI-only library with no visual
interface.

The fix was verified by:

1. Running the new test cases that check behaviour with missing WASM files
2. Running the existing `Worker.ts` tests to ensure no regression
3. Running the full `quality.sh` script which completed successfully (1785 tests
   passed)

## Test Plan

Added new tests in `test/multithreading/WasmActivationPayloadMissing.ts`:

- `loadWasmActivationInitPayload returns null when files are missing` - Verifies
  the function returns `null` for non-existent paths
- `isWasmActivationPayloadAvailable returns false when files are missing` -
  Verifies the availability check returns `false` for non-existent paths
- `isWasmActivationPayloadAvailable returns true when files exist` - Verifies
  the availability check returns `true` when WASM files are present
- `loadWasmActivationInitPayload returns payload when files exist` - Verifies
  the payload is correctly loaded when files are present
