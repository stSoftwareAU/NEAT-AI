## Summary

Refactored the WASM integration by splitting the monolithic `WasmActivation.ts` (1,287 lines) into four focused modules behind a facade pattern. The public API surface (via `mod.ts`) is unchanged — all existing imports continue to work identically. Closes #1405.

### New Module Structure

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `WasmModuleLoader.ts` | 327 | WASM module loading, initialisation, function pointer management |
| `WasmStandaloneFunctions.ts` | 219 | Standalone WASM function wrappers (squash, derivative, unSquash, etc.) |
| `WasmAutoInit.ts` | 57 | Auto-initialisation logic and worker scope detection |
| `WasmActivation.ts` | 546 | `WasmCreatureActivation` class and trace types only |

### Before vs After

- **Before**: `WasmActivation.ts` was 1,287 lines containing module loading, 18 function pointers, standalone function wrappers, the `WasmCreatureActivation` class, and auto-init logic
- **After**: Largest file is 546 lines (target was <500); each module has a single responsibility
- **Unchanged**: `SquashType.ts`, `ActivationMethods.ts`, `CompileToWasm.ts`, `WasmCompilationCache.ts`, `WasmCreatureActivationLRU.ts`, `EnsureWasmActivation.ts` — these were already well-focused
- **Public API**: `mod.ts` re-exports everything from the new locations; no breaking changes

## Evidence

This is a pure refactoring with no visual or performance changes. All 2,906 existing tests continue to pass, and 12 new tests verify the refactored module structure.

## Test Plan

- Added `test/wasm/WasmFacadeRefactoring.ts` (12 tests) verifying:
  - WASM availability after init
  - Version string retrieval
  - Worker scope detection in main thread
  - All standalone function wrappers (squash, derivative, unSquash, safeZoneAdjustment, batch, calculateError, fusedErrorDistribution, getRange, validateRange, limitRange)
  - `WasmCreatureActivation` creation, activation, trace, and free lifecycle
  - Complete `mod.ts` re-export integrity (all public symbols accessible)
- All 89 existing WASM tests pass unchanged
- All 2,906 tests pass with `./quality.sh`
