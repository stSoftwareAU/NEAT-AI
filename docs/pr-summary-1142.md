## Summary

Implements WASM Migration Phase 10: Range validation in Rust/WASM for all activation functions (#1142).

This phase adds three new WASM-exported functions for range validation:

1. **`get_range(squash_type)`** - Returns the valid output range `(low, high)` for an activation function
2. **`validate_range(squash_type, activation)`** - Returns `true` if the activation value is within the valid range
3. **`limit_range(squash_type, value)`** - Clamps a value to the valid range for the activation function

### Range Definitions

All 35 activation functions have correct range definitions:

| Category | Activations | Range |
|----------|-------------|-------|
| Bounded [0, 1] | Logistic, Gaussian, Step | `[0.0, 1.0]` |
| Bounded [-1, 1] | Tanh, HardTanh, Sine, Cosine, BipolarSigmoid, Bipolar, ISRU | `[-1.0, 1.0]` |
| Bounded [0, 6] | ReLU6 | `[0.0, 6.0]` |
| Bounded [-π/2, π/2] | ArcTan | `[-1.571, 1.571]` |
| Semi-bounded [0, ∞) | ReLU, Absolute, Square, Sqrt, Exponential | `[0.0, f32::MAX]` |
| Semi-bounded (-∞, 0] | LogSigmoid | `[f32::MIN, 0.0]` |
| Semi-bounded [-1, ∞) | ELU | `[-1.0, f32::MAX]` |
| Unbounded | Identity, LeakyReLU, Tan, BentIdentity, Complement, Cube, StdInverse | `[f32::MIN, f32::MAX]` |
| Special minimums | Swish (-0.278), Mish (-0.309), GELU (-0.17) | Empirically determined lower bounds |
| Aggregate | Minimum, Maximum, If | `[f32::MIN, f32::MAX]` |

### Implementation Details

- **Rust (`wasm_activation/src/lib.rs`)**: Added `apply_get_range()`, `apply_validate_range()`, and `apply_limit_range()` internal functions with comprehensive match statements for all squash types
- **WASM exports**: Added `get_range()`, `validate_range()`, and `limit_range()` functions with wasm_bindgen
- **TypeScript wrappers (`src/wasm/WasmActivation.ts`)**: Added `wasmGetRange()`, `wasmValidateRange()`, and `wasmLimitRange()` functions with proper typing

## Evidence

This is a library/API change with no visual interface. The implementation is verified through comprehensive unit tests in both Rust and TypeScript.

**Rust tests (cargo test):**
- `test_get_range_bounded` - Verifies bounded activations have correct ranges
- `test_get_range_unbounded` - Verifies unbounded activations use f32::MAX bounds
- `test_get_range_special_bounds` - Verifies ArcTan, LogSigmoid, ELU, GELU special ranges
- `test_validate_range_valid` - Verifies valid values return true
- `test_validate_range_invalid` - Verifies invalid/NaN/Infinity values return false
- `test_limit_range_clamping` - Verifies clamping and Infinity handling
- `test_range_aggregate_functions` - Verifies aggregate functions have unbounded ranges

**TypeScript tests (`test/wasm/WasmRangeValidation.ts`):**
- 13 comprehensive tests covering all aspects of range validation
- All tests pass

## Test Plan

- Added `test/wasm/WasmRangeValidation.ts` with 13 test cases covering:
  - Module availability verification
  - Range matching for bounded activations (Logistic, Tanh, ReLU6, etc.)
  - Range matching for unbounded activations (Identity, LeakyReLU, etc.)
  - Range matching for semi-bounded activations (ReLU, Exponential, etc.)
  - Validation for valid activation values
  - Validation for invalid values (out of range, NaN, Infinity)
  - Limit function clamping behaviour
  - Special ranges for GELU, LogSigmoid, ELU, ArcTan, Softplus, ISRU
  - Aggregate function unbounded ranges

- Added Rust unit tests in `wasm_activation/src/lib.rs`:
  - `test_get_range_bounded`
  - `test_get_range_unbounded`
  - `test_get_range_special_bounds`
  - `test_validate_range_valid`
  - `test_validate_range_invalid`
  - `test_limit_range_clamping`
  - `test_range_aggregate_functions`

All tests pass with `cargo test` (40 tests) and `deno test` (15 tests for range validation).
