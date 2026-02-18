## Summary

Fused backprop inner loop to eliminate TS/WASM boundary crossings during
backpropagation. Closes #1520.

Creates a `fused_backprop_neuron` Rust/WASM function that performs weight
accumulation for all inbound synapses of a neuron in a single WASM call,
replacing N separate `accumulateWeight` calls with a single boundary crossing.

### Changes

- **New Rust module** (`wasm_activation/src/fused_backprop.rs`): Combines N
  weight accumulations + bias accumulation into one WASM function. Reuses
  existing `accumulate_weight_single` and `accumulate_bias_single` from the
  accumulate module.
- **TypeScript bridge** (`src/wasm/WasmStandaloneFunctions.ts`):
  `wasmFusedBackpropNeuron()` wrapper with `FusedBackpropNeuronResult` type.
- **Neuron.propagate() restructured** (`src/architecture/Neuron.ts`): Two-phase
  approach:
  - Phase 1: Recursive upstream propagation with data collection into typed
    arrays
  - Phase 2: Single fused WASM call for all weight accumulations
  - Graceful fallback to per-synapse TS calls if WASM unavailable
- **Pre-allocated buffers** (`src/propagate/BackpropBuffers.ts`): Added
  `Float64Array` buffers to the reusable buffer pool for zero-allocation in the
  hot path.

## Evidence

### Benchmark Results (Apple M4 Pro, Deno 2.6.8)

| Synapse Count | Separate TS | Fused WASM | Winner                      |
| ------------- | ----------- | ---------- | --------------------------- |
| 10            | 134 ns      | 278 ns     | TS 2.08x faster             |
| 50            | 632 ns      | 765 ns     | TS 1.21x faster             |
| **200**       | **2.6 µs**  | **2.0 µs** | **Fused WASM 1.32x faster** |
| **1000**      | **14.8 µs** | **8.1 µs** | **Fused WASM 1.83x faster** |

The crossover point is around 100 synapses. For large neurons (200+ synapses),
the fused approach eliminates enough boundary crossing overhead to outperform
separate TS calls.

Run benchmarks:
`deno bench --allow-read --allow-env bench/FusedBackpropNeuron.ts`

### All Existing Tests Pass

All 3930 existing tests pass unchanged, confirming numerical equivalence.

## Test Plan

- Added `test/wasm/FusedBackpropNeuron.ts` with 7 tests:
  - Single synapse matches TS `accumulateWeight`
  - Multiple synapses match individual calls
  - Bias accumulation matches TS `accumulateBias`
  - Empty synapses produces only bias result
  - Non-finite inputs are skipped
  - Negative activations tracked correctly
  - Large batch (50 synapses) matches individual calls
- Added `bench/FusedBackpropNeuron.ts` benchmark comparing fused vs separate at
  10/50/200/1000 synapse counts
- 178 Rust unit tests in `fused_backprop.rs` module (5 tests) plus all existing
  Rust tests pass
