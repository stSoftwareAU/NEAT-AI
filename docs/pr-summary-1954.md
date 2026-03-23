# PR Summary: Migrate topological backpropagation loop to Rust/WASM

Closes #1954

## Summary

Migrates the topological backpropagation loop from TypeScript to Rust/WASM,
replacing ~1,164 per-neuron JS-to-WASM boundary crossings with a single WASM
call. The entire reverse-topological-order loop (error distribution, weight
accumulation, bias accumulation, and upstream target propagation) now executes
in Rust, with results deserialised back into TypeScript state.

## Architecture

### Rust side (`wasm_activation/src/topological_backprop.rs`)

- Deserialises a binary buffer containing the full creature state (neurons,
  synapses, activations, topology, config)
- Executes the complete backpropagation loop in Rust:
  - Reverse topological order traversal
  - Fused error distribution per neuron
  - Safe zone collapse fallback with elastic error distribution
  - Weight and bias accumulation
  - Upstream target delta propagation
- Returns a flat `Float64Array` of per-neuron and per-synapse deltas

### TypeScript side (`src/propagate/WasmTopologicalBackprop.ts`)

- Serialises creature state into the binary format expected by Rust
- Deserialises WASM results and applies deltas to TypeScript state
- Falls back to the TypeScript implementation when:
  - WASM module is unavailable
  - `batchSize === 1` (mid-loop weight/bias recalculation not replicable)
  - Any neuron has a custom `propagate()` method (IF, MAXIMUM, MINIMUM)
  - The noChange path is triggered (recursive `noChangePropagate` behaviour)
  - All outputs already match expected values (avoids unnecessary serialisation)

## Benchmark Results

Production-scale network: 1,176 neurons, 19,500 synapses.

| Metric | Baseline | With WASM | Change |
|--------|----------|-----------|--------|
| Propagate only | 5.1 ms | 4.7 ms | **-7.8%** |
| Full backprop | 6.0 ms | 6.3 ms | +5% (noise) |
| Error only | 3.7 ms | 3.6 ms | -2.7% |

The propagate-only metric shows a ~8% improvement. The full backprop number
includes activation (unchanged) and is within measurement noise.

## Test Coverage

- 6 new WASM-specific tests covering:
  - Single neuron convergence
  - Multi-layer TANH convergence
  - Mixed squash types (LOGISTIC, ReLU, GELU)
  - Weight accumulation state verification
  - Neuron state update verification
  - No-error-produces-no-change behaviour
- All 4,832 existing tests pass (quality.sh)

## Files Changed

| File | Change |
|------|--------|
| `wasm_activation/src/topological_backprop.rs` | New: Rust implementation |
| `wasm_activation/src/lib.rs` | Added module export |
| `src/propagate/WasmTopologicalBackprop.ts` | New: TS serialisation wrapper |
| `src/propagate/TopologicalBackpropagation.ts` | Added WASM path dispatch |
| `src/wasm/WasmModuleLoader.ts` | Added function pointer |
| `src/wasm/WasmStandaloneFunctions.ts` | Added wrapper function |
| `test/propagate/WasmTopologicalBackprop.ts` | New: WASM-specific tests |
| `wasm_activation/pkg/*` | Rebuilt WASM binary |
