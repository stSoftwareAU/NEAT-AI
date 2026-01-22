## Summary

This PR implements Phase 8 of the WASM Migration: `safeZoneAdjustment()` in
Rust/WASM for all activation functions.

The `safeZoneAdjustment()` function returns a float from 0 (not safe) to 1
(fully safe) indicating how suitable it is to backpropagate through a neuron
based on saturation levels. This is critical for training stability as it
prevents pushing already-saturated neurons further into saturation.

### Changes Made

1. **Rust Implementation** (`wasm_activation/src/lib.rs`):
   - Added `apply_safe_zone_adjustment()` function implementing safe zone logic
     for all 35 activation functions
   - Each activation function has customised logic based on its saturation
     behaviour:
     - **Identity, LeakyReLU, BentIdentity**: Nearly always safe, with
       weight-based adjustments
     - **ReLU, ReLU6**: Recovery logic for dead neurons
     - **TANH, Logistic, HardTanh**: Safe zones with gradual fade and recovery
     - **SELU, ELU, Swish, Mish, GELU, etc.**: Weight-based safety checks with
       fade zones
     - **SINE, Cosine, TAN**: Slope-based safety (periodic functions)
     - **BIPOLAR, Step**: Discontinuous functions with special handling
     - **Aggregate functions (Minimum, Maximum, If)**: Always return 0 (not
       differentiable)
   - Exported via wasm_bindgen as `safe_zone_adjustment()`

2. **TypeScript Wrapper** (`src/wasm/WasmActivation.ts`):
   - Added `wasmSafeZoneAdjustment()` function
   - Updated both `initWasmActivation()` and `initWasmActivationSync()` to load
     the new function
   - Added proper JSDoc documentation

3. **Module Export** (`src/wasm/mod.ts`):
   - Exported `wasmSafeZoneAdjustment` for external use

4. **Comprehensive Tests** (`test/WasmSafeZoneAdjustment.ts`):
   - 36 test cases covering all activation functions
   - Tests verify WASM results match JS implementations
   - Tests cover safe zones, recovery zones, saturation zones
   - Tests verify non-finite inputs return 0
   - Comprehensive comparison test: 1200/1200 passed

## Evidence

Unable to generate screenshot: This is a WASM/Rust implementation with no visual
interface. The implementation is verified through comprehensive unit tests.

### Test Results

All 36 tests pass, including:

- Individual tests for each of the 32 activation functions with
  safeZoneAdjustment
- Aggregate function tests (Minimum, Maximum, If return 0)
- Non-finite input handling tests
- Comprehensive comparison test (1200 combinations tested)

```
running 36 tests from ./test/WasmSafeZoneAdjustment.ts
WASM SafeZoneAdjustment: Module initialisation ... ok
WASM SafeZoneAdjustment: IDENTITY ... ok
WASM SafeZoneAdjustment: ReLU ... ok
[... all 36 tests pass ...]
Comprehensive SafeZoneAdjustment test: 1200/1200 passed

ok | 36 passed | 0 failed
```

Full quality.sh passes: `ok | 1673 passed (2 steps) | 0 failed | 1 ignored`

## Test Plan

- [x] Added `test/WasmSafeZoneAdjustment.ts` with comprehensive tests
- [x] Tests verify WASM and JS implementations match for all activation
      functions
- [x] Tests cover edge cases (non-finite inputs, boundary values, recovery
      conditions)
- [x] Tests verify aggregate functions return 0
- [x] Tests verify COMPLEMENT returns 1.0 (never saturates)
- [x] All existing tests continue to pass (1673 tests total)
- [x] `./quality.sh` passes

## Acceptance Criteria Checklist

- [x] All activation functions have safeZoneAdjustment implemented in Rust
- [x] Recovery logic implemented for each function
- [x] Exported via wasm_bindgen
- [x] TypeScript wrapper function added
- [x] Tests verify WASM and JS results match
- [x] All existing tests pass
- [x] `./quality.sh` passes

Fixes #1140
