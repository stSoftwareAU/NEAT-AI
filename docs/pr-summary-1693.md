## Summary

Replace all generic `throw new Error(...)` in the WASM module with typed `WasmError` instances using appropriate reason codes. Closes #1693.

### Changes

- **`src/wasm/WasmActivation.ts`**: Replaced 21 `throw new Error(...)` with `WasmError` using `ACTIVATION_FAILED` reason for freed-resource and input/output mismatch errors
- **`src/workers/WasmWorkerInit.ts`**: Replaced 2 `throw new Error(...)` with `WasmError` using `MODULE_NOT_LOADED` reason for missing payload and init failure
- **`src/workers/WasmActivationPayload.ts`**: Replaced 1 `throw new Error(...)` with `WasmError` using `MODULE_NOT_LOADED` reason for payload load failure

## Evidence

This is a backend-only change with no visual output. All 4350 tests pass via `./quality.sh`.

## Test Plan

- Added `test/wasm/WasmActivationErrors.ts` (16 tests) verifying:
  - All activation methods throw `WasmError` (not `Error`) after `free()`
  - All activation methods throw `WasmError` on input length mismatch
  - `activateInto` throws `WasmError` on output buffer length mismatch
  - Batch cost methods throw `WasmError` after `free()`
- Added `test/workers/WasmWorkerInitErrors.ts` (3 tests) verifying:
  - `WasmError` with `MODULE_NOT_LOADED` reason for worker error scenarios
