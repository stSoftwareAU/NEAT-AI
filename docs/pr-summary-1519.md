## Summary

Migrate the elastic error distribution algorithm from TypeScript to Rust/WASM.
The `distributeElasticError` function performs multi-pass floating-point
arithmetic during backpropagation — calculating activation-squared scores,
weight-squared fallbacks, and redistributing floating-point residues. Moving
this to WASM eliminates per-element object property access overhead and keeps
all intermediate float values in WASM linear memory. Closes #1519.

## Changes

### Rust/WASM (`wasm_activation/`)

- **New `elastic_distribution.rs`**: Implements the three-pass algorithm
  (activation² scoring, weight² fallback, equal split) using struct-of-arrays
  layout for better data locality in WASM linear memory
- **`lib.rs`**: Registers the new module and exports `distribute_elastic_error`
  via `#[wasm_bindgen]`
- 13 Rust unit tests covering all code paths and edge cases

### TypeScript wrappers (`src/wasm/`)

- **`WasmModuleLoader.ts`**: Added function pointer and getter for
  `distribute_elastic_error`
- **`WasmStandaloneFunctions.ts`**: Added `wasmDistributeElasticError()` wrapper
- **`mod.ts`**: Re-exported the new function

### Integration (`src/propagate/`)

- **`ElasticDistribution.ts`**: Now tries the WASM path first (converting the
  `ElasticLink[]` to struct-of-arrays `Float64Array`s), falling back to the
  original TypeScript implementation when WASM is unavailable

## Evidence — Benchmark Results

Tested on Apple M4 Pro, Deno 2.6.8:

| Link Count | TS (avg) | WASM-direct (avg) | Speedup  |
| ---------- | -------- | ----------------- | -------- |
| 10         | 800 ns   | 247 ns            | **3.2x** |
| 50         | 1.4 µs   | 348 ns            | **4.0x** |
| 100        | 2.2 µs   | 470 ns            | **4.6x** |
| 200        | 3.9 µs   | 772 ns            | **5.0x** |

The WASM implementation delivers **3.2x–5.0x speedup**, exceeding the estimated
1.5–3x from the issue. The advantage grows with link count due to better data
locality and elimination of per-element object property access in WASM linear
memory.

## Test Plan

- 12 new WASM-specific tests in `test/wasm/ElasticDistribution.ts` covering:
  - Basic proportional distribution (activation² weighting)
  - Safe zone blocking and clamping (both above 1 and negative)
  - Weight-based fallback when activations are zero
  - Equal split fallback when both activations and weights are zero
  - Error conservation (sum of shares equals original error)
  - Negative error conservation
  - Single-link case
  - NaN activation handling
  - Empty links edge case
- 13 Rust unit tests in `elastic_distribution.rs`
- All 3911 existing tests pass unchanged
- New benchmark in `bench/ElasticDistribution.ts`
