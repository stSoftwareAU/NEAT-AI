## Summary

Replace unrecoverable `AssertionError` (from `fail()`) with typed `WasmError`
when WASM activation instantiation fails. Previously, when a creature's topology
caused `RuntimeError: unreachable` during WASM compilation or activation, the
code called `fail()` which threw an `AssertionError` that crashed the entire
worker process. Now the error surfaces as a catchable `WasmError` with reason
`ACTIVATION_FAILED`, allowing callers to handle the failure gracefully. Closes
#2146.

### Changes

- **`src/creature/CreatureActivation.ts`**:
  - `activateWasm`: Replaced `fail()` with `throw new WasmError(...)`. Added
    try-catch around the WASM activation call to wrap `RuntimeError` traps.
  - `activateAndTraceWasm`: Replaced `fail()` with `throw new WasmError(...)`.
    Added the missing third retry step (`clearWasmCompilationCache` + retry) to
    match `activateWasm`. Added try-catch around the WASM activation call.
  - `evaluateDir`: Replaced `fail()` with `throw new WasmError(...)`.
  - Removed unused `fail` import from `@std/assert`.

## Evidence

- Tests verify that both `activateWasm` and `activateAndTraceWasm` throw
  `WasmError` (not `AssertionError`) with reason `ACTIVATION_FAILED` when WASM
  instantiation fails due to corrupted creature topology.

## Test Plan

- Added `test/wasm/WasmInstantiationFailure.ts` with two tests:
  - `activateWasm throws WasmError not AssertionError on instantiation failure`
  - `activateAndTraceWasm throws WasmError not AssertionError on instantiation failure`
- All 5219 existing tests continue to pass.
