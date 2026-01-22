## Summary

This PR implements the inverse function `unSquash()` in Rust/WASM for all activation functions, completing Phase 7 of the WASM migration (#1139).

The `unSquash()` function is used in backpropagation to convert activation-space targets back to value-space. This PR adds:

1. **Rust Implementation** (`wasm_activation/src/lib.rs`):
   - `apply_unsquash()` function with inverse formulas for all 32 standard activation functions
   - Exported `unsquash(squash_type: u8, activation: f32, hint: f32)` via wasm_bindgen
   - Comprehensive unit tests for unsquash operations

2. **TypeScript Integration** (`src/wasm/`):
   - `wasmUnSquash(squashType, activation, hint?)` wrapper function
   - Updated module exports

3. **Tests** (`test/WasmUnSquash.ts`):
   - Roundtrip tests: `squash(x)` → `unsquash(activation, x)` ≈ `x`
   - JS/WASM comparison tests
   - Edge case and numerical stability tests

### Inverse Formula Categories

| Category | Functions | Approach |
|----------|-----------|----------|
| Direct algebraic | Identity, LeakyReLU, Complement, Cube | Simple formula inversion |
| Logarithmic | Logistic, Tanh, BipolarSigmoid, Softplus, ELU, SELU, LogSigmoid | Log-based transformation |
| Trigonometric | Sine, Cosine, Tan, ArcTan | Inverse trig with periodicity handling |
| Iterative | Swish, Mish, GELU, BentIdentity | Newton-Raphson iterations |
| Hint-dependent | ReLU, ReLU6, Gaussian, Absolute, Square, Sqrt, Bipolar, Step, ISRU | Use hint for ambiguous cases |

## Evidence

Unable to generate screenshot: This is a WASM/Rust backend implementation with no visual interface. The implementation is verified through automated unit tests.

## Test Plan

- Added `test/WasmUnSquash.ts` with comprehensive test coverage:
  - **Module initialisation test**: Verifies WASM module loads correctly
  - **Per-function tests**: Individual tests for all 32 activation functions
  - **Roundtrip tests**: Verifies `squash(x)` → `unsquash(activation, x)` returns original value
  - **JS/WASM comparison tests**: Confirms WASM matches TypeScript implementations
  - **Edge case tests**: Numerical stability for boundary values
  - **Aggregate function tests**: Verifies hint-based fallback for non-invertible functions

- All existing tests pass (1637 tests)
- `./quality.sh` passes cleanly
- Rust unit tests pass (26 tests including new unsquash tests)
