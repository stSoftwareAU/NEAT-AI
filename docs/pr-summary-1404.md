## Summary

Add typed error classes `DiscoveryError` and `WasmError` so consumers can catch
and handle specific failure modes programmatically. Previously the codebase threw
generic `Error` instances for discovery FFI failures, data corruption, invalid
creatures, WASM module loading, and activation failures. Closes #1404.

### DiscoveryError

Replaces generic `Error` in discovery/FFI code with a typed error carrying a
`reason` field:

| Reason             | Usage                                          |
|--------------------|------------------------------------------------|
| LIBRARY_NOT_FOUND  | Rust FFI library not at expected path          |
| GPU_UNAVAILABLE    | Metal/GPU compute not available                |
| FFI_CRASH          | Library could not be loaded or permission denied |
| TIMEOUT            | Discovery operation timed out                  |
| DATA_CORRUPTION    | Neuron error counts exceed reasonable maximums |
| INVALID_CREATURE   | Discovery produced an invalid creature         |

### WasmError

Replaces generic `Error` in WASM activation code with a typed error carrying a
`reason` field:

| Reason             | Usage                                          |
|--------------------|------------------------------------------------|
| COMPILATION_FAILED | WASM module failed to compile                  |
| ACTIVATION_FAILED  | Squash function not defined in WASM            |
| MODULE_NOT_LOADED  | WASM not initialised                           |

### Files changed

- `src/errors/DiscoveryError.ts` - New typed error class
- `src/errors/WasmError.ts` - New typed error class
- `src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts` - Use `DiscoveryError`
- `src/discovery/DiscoveryPostValidate.ts` - Use `DiscoveryError`
- `src/wasm/WasmActivation.ts` - Use `WasmError` for module-not-loaded checks
- `src/wasm/ActivationMethods.ts` - Use `WasmError` for squash function errors
- `src/wasm/EnsureWasmActivation.ts` - Use `WasmError` for load failures

## Evidence

This is a backend/type-system change with no visual output. All 2882 existing
tests continue to pass, plus 16 new error type tests verify the behaviour.

## Test Plan

- `test/errors/DiscoveryError.ts` - 9 tests covering all reason values,
  `instanceof` checks, and selective catching
- `test/errors/WasmError.ts` - 7 tests covering all reason values,
  `instanceof` checks, and selective catching
- Existing tests in `test/ErrorGuidedStructuralEvolution/RustDiscoveryErrorValidation.ts`
  continue to pass (they catch `Error`, which `DiscoveryError` extends)
