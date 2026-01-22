# PR Summary: WASM Migration Phase 6 - Implement derivative() in Rust/WASM

## Summary

This PR implements the `derivative()` function for all 32 standard activation
functions in Rust/WASM, completing Phase 6 of the WASM migration. This follows
the DRY principle by providing a single source of truth for derivative
calculations that can be used in backpropagation.

### Key Changes

1. **Rust Implementation** (`wasm_activation/src/lib.rs`):
   - Added `apply_derivative()` function with analytical derivative formulas for
     all 32 activation functions
   - Exported `derivative()` function via `wasm_bindgen` for standalone testing
   - Added 13 Rust unit tests for derivative functions

2. **TypeScript Wrapper** (`src/wasm/WasmActivation.ts`):
   - Added `wasmDerivative()` function as the TypeScript interface to the WASM
     derivative
   - Updated module initialisation to capture the derivative function reference

3. **Module Exports** (`src/wasm/mod.ts`):
   - Exported `wasmDerivative` function for public API access

4. **Test Suite** (`test/WasmDerivative.ts`):
   - 35 comprehensive tests comparing WASM derivatives with JS implementations
   - Tests cover all 32 standard activation functions plus aggregate functions
   - Uses floating-point tolerance (1e-4) to account for f32/f64 precision
     differences

### Derivative Formulas Implemented

| Category           | Functions                                                             |
| ------------------ | --------------------------------------------------------------------- |
| **Constant**       | Identity (1), Complement (-1), Bipolar (0), Step (0.01 near 0)        |
| **Linear**         | ReLU, ReLU6, LeakyReLU, HardTanh                                      |
| **Polynomial**     | Square (2x), Cube (3x²), Sqrt (1/2√x), Absolute (sign)                |
| **Sigmoid Family** | Logistic (y(1-y)), Tanh (1-y²), BipolarSigmoid ((1-y²)/2), LogSigmoid |
| **Exponential**    | ELU, SELU, Exponential, Gaussian                                      |
| **Trigonometric**  | Sine (cos), Cosine (-sin), Tan (sec²), ArcTan (1/(1+x²))              |
| **Complex**        | Swish, Mish, GELU (with numerical stability handling)                 |
| **Other**          | Softsign, Softplus, BentIdentity, StdInverse, ISRU                    |
| **Aggregate**      | MINIMUM, MAXIMUM, IF (return 0 - no traditional derivatives)          |

## Evidence

This is a functional/API enhancement without UI changes. Evidence is provided
through comprehensive test results:

```
running 35 tests from ./test/WasmDerivative.ts
WASM Derivative: Module initialisation ... ok
WASM Derivative: Identity ... ok
WASM Derivative: ReLU ... ok
WASM Derivative: ReLU6 ... ok
WASM Derivative: LeakyReLU ... ok
WASM Derivative: SELU ... ok
WASM Derivative: ELU ... ok
WASM Derivative: LOGISTIC (Sigmoid) ... ok
WASM Derivative: TANH ... ok
WASM Derivative: HardTanh ... ok
WASM Derivative: Softsign ... ok
WASM Derivative: Softplus ... ok
WASM Derivative: Swish ... ok
WASM Derivative: Mish ... ok
WASM Derivative: GELU ... ok
WASM Derivative: SINE ... ok
WASM Derivative: Cosine ... ok
WASM Derivative: TAN ... ok
WASM Derivative: ArcTan ... ok
WASM Derivative: GAUSSIAN ... ok
WASM Derivative: BentIdentity ... ok
WASM Derivative: BipolarSigmoid ... ok
WASM Derivative: Bipolar ... ok
WASM Derivative: Step ... ok
WASM Derivative: Complement ... ok
WASM Derivative: Absolute ... ok
WASM Derivative: Square ... ok
WASM Derivative: Cube ... ok
WASM Derivative: Sqrt ... ok
WASM Derivative: StdInverse ... ok
WASM Derivative: Exponential ... ok
WASM Derivative: LogSigmoid ... ok
WASM Derivative: ISRU ... ok
WASM Derivative: Aggregate functions return 0 ... ok
WASM Derivative: Comprehensive comparison with JS implementations ... ok

ok | 35 passed | 0 failed
```

Full test suite result: **1601 passed | 0 failed | 1 ignored**

## Test Plan

### New Tests Added

- `test/WasmDerivative.ts` - 35 tests for WASM derivative functionality:
  - Module initialisation test
  - Individual tests for each of 32 standard activation functions
  - Aggregate functions test (MINIMUM, MAXIMUM, IF return 0)
  - Comprehensive comparison test verifying all WASM derivatives match JS
    implementations

### Rust Unit Tests Added

- 13 new tests in `wasm_activation/src/lib.rs`:
  - `test_derivative_identity`
  - `test_derivative_relu`
  - `test_derivative_leaky_relu`
  - `test_derivative_logistic`
  - `test_derivative_tanh`
  - `test_derivative_sine`
  - `test_derivative_cosine`
  - `test_derivative_square`
  - `test_derivative_cube`
  - `test_derivative_complement`
  - `test_derivative_absolute`
  - `test_derivative_arctan`
  - `test_derivative_aggregate_functions`

### Acceptance Criteria Verification

- [x] All 32 standard activation derivatives implemented in Rust
- [x] Exported via wasm_bindgen
- [x] TypeScript wrapper function added (`wasmDerivative`)
- [x] Tests verify WASM and JS derivatives match (within floating-point
      tolerance)
- [x] All existing tests pass (1601 tests)
- [x] `./quality.sh` passes

## Related Issues

- Part of #1136 - Replace all JS squash functions with Rust/WASM
- Implements #1138 - WASM Migration Phase 6

## Notes

- Aggregate functions (MINIMUM, MAXIMUM, IF) return 0 as they don't have
  traditional derivatives
- StdInverse derivative handles x=0 specially to match JS `Math.sign(0) = 0`
  behaviour
- Complex derivatives (Mish, GELU) use larger tolerance (1e-3) due to complex
  formulas
