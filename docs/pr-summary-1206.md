## Summary

Fixed issue #1206 where `WorkerHandler` would throw an `AssertionError` with
message "WASM activation payload missing. Build `wasm_activation/pkg` first."
when the WASM activation files were not built.

The fix makes WASM activation optional. When the WASM files
(`wasm_activation/pkg/wasm_activation.js` and
`wasm_activation/pkg/wasm_activation_bg.wasm`) are not available, the library
now gracefully falls back to JavaScript-based activation instead of crashing.
This is important for:

1. **Library consumers** - Users who install the library from JSR shouldn't need
   to build the WASM module locally to use the library
2. **Development environments** - Developers working on non-WASM parts of the
   codebase can run tests without building WASM first
3. **CI/CD pipelines** - Build pipelines that don't include the Rust/WASM
   toolchain can still function

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
