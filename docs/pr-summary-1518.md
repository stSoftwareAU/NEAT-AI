# PR Summary: WASM Migrate Weight/Bias Accumulation Batch Functions (#1518)

## Overview

Implements Rust/WASM versions of weight and bias accumulation functions for
backpropagation, with SIMD128-enabled batch processing. Benchmarking revealed
that WASM batch accumulation (4-way/8-way) is slower than TypeScript due to
JS↔WASM boundary crossing overhead for small batches, so production batch
functions remain TypeScript-only. However, WASM scalar `calculateWeight` and
`calculateBias` functions provide value and are integrated into the
backpropagation path with automatic TS fallback.

## Changes

### Rust/WASM (`wasm_activation/src/accumulate.rs`) — NEW

- `accumulate_weight_batch_4way` / `accumulate_weight_batch_8way` — batch weight
  accumulation with packed Float64Array I/O (7 values per synapse)
- `accumulate_bias_batch_4way` / `accumulate_bias_batch_8way` — batch bias
  accumulation with packed Float64Array I/O (3 values per neuron)
- `calculate_weight` — scalar weight finalisation with generation capping
- `calculate_bias` — scalar bias finalisation with generation capping
- Internal helpers: `limit_weight`, `limit_bias`, `accumulate_weight_single`,
  `accumulate_bias_single`
- 12 Rust unit tests covering all functions

### TypeScript Wrappers (`src/wasm/WasmStandaloneFunctions.ts`)

- Added 6 WASM wrapper functions with pre-allocated Float64Array buffers
- Batch wrappers return `boolean` (true = WASM handled, false = fallback)
- Scalar wrappers return `number | undefined` (undefined = fallback)

### WASM Module Loader (`src/wasm/WasmModuleLoader.ts`)

- Added 6 function pointer variables with explicit type declarations
- Added getter functions for each new WASM entry point

### Backpropagation Integration

- `src/propagate/Weight.ts`: `calculateWeight()` delegates to WASM first, falls
  back to TypeScript. Batch functions remain TS-only (WASM slower).
- `src/propagate/Bias.ts`: `calculateBias()` delegates to WASM first, falls back
  to TypeScript. Batch functions remain TS-only (WASM slower).

### Tests

- `test/propagate/WasmAccumulateWeight.ts` — 5 tests verifying WASM↔TS parity
  for 4-way, 8-way, multi-iteration, non-finite handling, and calculateWeight
- `test/propagate/WasmAccumulateBias.ts` — 5 tests verifying WASM↔TS parity for
  4-way, 8-way, multi-iteration, non-finite handling, and bias limiting

### Benchmark (`bench/WasmBatchAccumulation.ts`)

- Compares single-call baseline vs 4-way and 8-way batch accumulation
- Documents that WASM batch functions are slower due to TypedArray allocation
  overhead at the JS↔WASM boundary for small batch sizes (4/8 items)

## Benchmark Results

WASM batch accumulation for 4/8 items is 7–16x slower than TypeScript due to:

1. `wasm-bindgen` `Vec<f64>` return creates a new `Float64Array` per call
2. Pre-allocated input buffers help but cannot eliminate return allocation
3. The computation per batch (4–8 multiply-adds) is too small to amortise the
   boundary crossing cost

WASM scalar `calculateWeight`/`calculateBias` have acceptable overhead since
they pass/return only primitive numbers with no array allocation.

## Test Results

All 3898 tests pass. No existing tests were modified.
