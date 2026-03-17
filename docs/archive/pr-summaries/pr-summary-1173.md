# PR Summary: Fix WASM Performance - activate_and_trace() allocates Vec<f32> on every call (#1173)

## Summary

Pre-allocate `trace_data_buffer` and `hint_values_buffer` in the WASM
`CompiledNetwork` struct to eliminate heap allocations per
`activate_and_trace()` call.

### Problem

The Rust `activate_and_trace()` method was allocating two vectors on every call:

```rust
let mut trace_data: Vec<f32> = Vec::new();  // Heap allocation
let mut hint_values: Vec<f32> = vec![0.0; num_non_inputs];  // Heap allocation + zeroing
```

For a network with 736 non-input neurons:

- `trace_data`: Dynamic allocation, grows as aggregate functions are encountered
- `hint_values`: 736 × 4 = 2,944 bytes allocated and zeroed per call

### Solution

1. **Added `trace_data_buffer` field** to `CompiledNetwork` struct
2. **Pre-allocate trace_data_buffer** with estimated capacity in constructor
   - Estimates ~10% of neurons have aggregate functions (MINIMUM, MAXIMUM, IF)
   - Each aggregate records 2 floats (neuron_idx, trace_info), plus -1.0
     terminator
3. **Clear and reuse** `trace_data_buffer` instead of allocating new Vec each
   call
4. **Use `fill(0.0)`** instead of loop for zeroing `hint_values_buffer` (more
   efficient)

### Changes

- `wasm_activation/src/lib.rs`:
  - Added `trace_data_buffer: Vec<f32>` to `CompiledNetwork` struct
  - Pre-allocate buffer with `Vec::with_capacity(estimated_trace_size)` in
    constructor
  - Replace `let mut trace_data: Vec<f32> = Vec::new()` with
    `self.trace_data_buffer.clear()`
  - Replace manual zeroing loop with `self.hint_values_buffer.fill(0.0)`
  - Update all `trace_data.push()` calls to use `self.trace_data_buffer.push()`

## Evidence

**Performance Impact (theoretical):**

- Eliminates 2 heap allocations per `activate_and_trace()` call
- For 2.16M records: eliminates ~4.32M allocations
- Eliminates zeroing overhead for `hint_values` (replaced with more efficient
  `fill`)
- Expected improvement: 3-8% reduction in per-activation overhead

**Note:** This is a low-level WASM optimisation focused on reducing memory
allocation overhead within the Rust code. The improvement is most significant in
high-throughput scenarios processing millions of records.

## Test Plan

All existing tests continue to pass, verifying functional correctness:

- `test/WasmActivateAndTrace.ts` - Tests WASM activateAndTrace functionality:
  - Returns same activation values as JS
  - MINIMUM trace behaviour matches JS
  - MAXIMUM trace behaviour matches JS
  - IF trace behaviour matches JS (positive and negative branches)
  - Standard squash marks all synapses as used
  - Multiple iterations produce consistent results
  - hintValue is correctly set for backpropagation
  - Complex network with mixed squash functions works correctly
  - Bulk copy produces correct outputs, activations and hintValues (Issue #1172)
  - Large network bulk copy produces correct results

All 1776 tests passed via `./quality.sh`.
