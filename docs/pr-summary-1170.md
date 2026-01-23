# WASM Performance Optimisation - Issue #1170

## Summary

This PR addresses the WASM performance issues identified in Issue #1170. The WASM implementation was previously **2.19x slower** than the JavaScript implementation. After implementing the "quick wins" optimisations from the issue, WASM is now **2.22x faster** than JavaScript - a complete reversal from being slower to being faster.

### Changes Implemented

1. **Issue #1175 - Typed Structs for Neuron/Synapse Data**
   - Replaced tuple-based storage `(f64, u8, usize, usize, bool)` with typed `NeuronData` struct
   - Replaced tuple-based storage `(usize, u8, f64)` with typed `SynapseData` struct
   - Better cache locality through explicit `#[repr(C)]` layout
   - Improved code readability and maintainability

2. **Issue #1173 - Pre-allocated Trace Buffers**
   - Added `hint_values_buffer: Vec<f32>` to `CompiledNetwork` struct
   - Pre-allocated during network construction instead of per-call allocation
   - Eliminates allocation overhead in `activate_and_trace()`

3. **Issue #1177 - Inlined Common Squash Functions**
   - Inlined the four most common activation functions (IDENTITY, ReLU, LOGISTIC, TANH)
   - These cover ~80% of typical neural networks
   - Avoids function call overhead and 35-way match statement for common cases
   - Falls back to generic `apply_squash_f64()` for other activation types

4. **Bulk Input Copy**
   - Replaced element-by-element input copying with `copy_from_slice()`
   - Applied to `activate()`, `activate_and_trace()`, and `activate_batch()`

5. **Issue #1172 - Bulk Copy in TypeScript**
   - Replaced element-by-element copying in `activateAndTrace()` with `Float32Array.set()` and `subarray()`
   - Zero-copy views for extracting outputs, activations, and hint values

## Evidence

### Benchmark Results

**Before (from Issue #1170 documentation):**
- WASM: 132.6 seconds for 2.16M activations
- JS: 60.5 seconds for 2.16M activations
- **WASM was 2.19x slower than JS**

**After (from `deno bench bench/ActivateWasm.ts`):**
```
group activation
| JS Activation           |         19.5 ms |          51.4 |
| WASM Activation         |          9.0 ms |         111.3 |
| WASM Batch Activation   |          8.8 ms |         114.0 |

summary
  WASM Batch Activation
     1.02x faster than WASM Activation
     2.22x faster than JS Activation
```

**WASM is now 2.22x FASTER than JS** - achieving the success criteria from Issue #1170.

### Test Configuration
- Network: 310 neurons (100 input, 200 hidden, 10 output), 7,830 synapses
- 1,000 activations per benchmark iteration
- CPU: Apple M4 Pro
- Runtime: Deno 2.6.4

## Test Plan

All existing tests pass (1,770 tests):
- WASM range validation tests in `test/wasm/WasmRangeValidation.ts`
- Full test suite via `./quality.sh`
- Benchmarks via `deno bench bench/ActivateWasm.ts`

The optimisations maintain full backward compatibility - no API changes were required.

## Files Changed

- `wasm_activation/src/lib.rs` - Rust WASM implementation
  - Added `NeuronData` and `SynapseData` structs
  - Added `hint_values_buffer` to `CompiledNetwork`
  - Inlined common squash functions
  - Bulk input copying

- `src/wasm/WasmActivation.ts` - TypeScript wrapper
  - Bulk copy using `Float32Array.set()` and `subarray()`

## Related Issues

This PR partially addresses Issue #1170 by implementing:
- #1172 - activateAndTrace() element-by-element copy
- #1173 - activate_and_trace() Vec<f32> allocation
- #1175 - Typed structs for neuron/synapse data
- #1177 - Specialised activation paths for common squash functions

Additional optimisations that could further improve performance:
- #1171 - Pre-allocated output buffers (partially done, full implementation would require API changes)
- #1176 - Batch activation mode (already exists, works well)
- #1178 - WASM SIMD for parallel synapse processing
- #1179 - WASM code generation to match JS JIT performance
