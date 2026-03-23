## Summary

Batch API design for amortising WASM boundary crossing overhead. Implements
three new batch operations that group multiple topology and weight/bias
calculations into single WASM calls, reducing per-operation boundary crossing
cost (~100-500 ns per call). Closes #1960.

### New batch APIs

1. **`validateTopologyBatch(topologies)`** — validates multiple creature
   topologies in a single WASM call by concatenating from/to index arrays and
   splitting results. Eliminates N-1 boundary crossings for N topologies.

2. **`calculateWeightBatch4Way(states, weights, config)`** — finalises 4 synapse
   weights in a single WASM call. Packs 8 f64 values per synapse (count,
   activations, adjusted values, current weight) into a flat Float64Array with
   shared config scalars.

3. **`calculateBiasBatch4Way(counts, biases, currentBiases, noChanges, config)`**
   — finalises 4 neuron biases in a single WASM call. Packs 3 f64 values per
   neuron with a separate noChange flags array.

### Architecture

- **Rust/WASM** (`wasm_activation/src/accumulate.rs`, `topology_ops.rs`): Three
  new `#[wasm_bindgen]` functions that delegate to existing single-item
  implementations in a loop
- **TypeScript bridge** (`src/wasm/WasmModuleLoader.ts`): Function pointer
  wiring for the 3 new WASM exports
- **TypeScript API** (`src/wasm/WasmBatchOps.ts`): High-level batch functions
  with pre-allocated buffers and fallback to individual WASM calls when batch
  functions are unavailable
- **Exports** (`src/wasm/mod.ts`): All 3 batch functions exported from the WASM
  module

Each batch function follows the established pattern: try WASM batch first, fall
back to individual WASM calls.

## Evidence

All 4882 tests pass including 12 new batch operation tests. Batch results match
individual call results to within 1e-10 tolerance.

## Test Plan

- `test/wasm/WasmBatchOps.ts` — 12 new tests:
  - **Batch topology validation** (4 tests): multiple valid topologies, empty
    array, single topology, mixed valid/invalid detection
  - **Batch weight calculation** (3 tests): matches individual calls, zero-count
    states, mixed zero/non-zero counts
  - **Batch bias calculation** (5 tests): matches individual calls, zero-count,
    noChange flag, mixed scenarios
- `wasm_activation/src/topology_ops.rs` — 3 new Rust unit tests for
  `validate_topology_batch`
- `wasm_activation/src/accumulate.rs` — existing Rust tests validate the
  underlying single-item functions
