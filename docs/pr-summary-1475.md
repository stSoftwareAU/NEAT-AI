## Summary

Replace remaining `any` types in the WASM activation layer with proper
TypeScript interfaces, improving compile-time type safety and
maintainability. Closes #1475.

### Changes

- **New `WasmCompiledNetwork` interface** (`src/wasm/WasmCompiledNetwork.ts`):
  Mirrors the public API of the WASM `CompiledNetwork` class, providing
  compile-time type checking without importing from WASM-generated bindings.
- **`WasmActivation.ts`**: Replaced `private network: any` with
  `private network: WasmCompiledNetwork` and removed both `no-explicit-any`
  lint suppressions.
- **`WasmModuleLoader.ts`**: Replaced `CompiledNetworkClass = any` with
  `WasmCompiledNetworkConstructor` and updated `getCompiledNetworkClass()`
  return type.
- **`ParallelFitnessEvaluation.ts`** (bench): Replaced
  `idleListeners: any[]` with `((worker: BenchMockWorker) => void)[]`.
- **`mod.ts`**: Exported the new `WasmCompiledNetwork` and
  `WasmCompiledNetworkConstructor` types.

Note: The `any` in `globalAccessors.ts` is intentional (JSR compatibility,
Issue #1429) and left unchanged per the issue description. The remaining
`WasmModule = any` in `WasmModuleLoader.ts` covers the dynamically imported
WASM JS bindings module and is out of scope for this issue.

## Evidence

This is a type-safety improvement with no visual or performance changes.
All 3635 tests pass. `quality.sh` passes cleanly (fmt, lint, type-check,
tests).

## Test Plan

- Added `test/wasm/WasmCompiledNetworkType.ts` with 8 tests verifying:
  - `getCompiledNetworkClass()` returns a typed constructor
  - Constructor creates valid `WasmCompiledNetwork` instances
  - All interface methods (`activate`, `activate_into`, `activate_view`,
    `activate_and_trace`, `reset_state`) work correctly
  - Readonly properties (`num_inputs`, `num_neurons`, `num_synapses`) return
    correct values
  - Results from the typed interface match `WasmCreatureActivation` wrapper
    output
