## Summary

Migrate full-scan score computation paths from TypeScript to Rust/WASM for large networks. When the score cache is cold or when the tracked second-maximum becomes stale after structural mutations, the weight/bias statistics (abs-sum, max, second-max) are now computed via WASM with f64 precision to match JavaScript number semantics. Closes #1521.

### Changes

- **New Rust module** (`wasm_activation/src/score_scan.rs`): Three `#[wasm_bindgen]` functions:
  - `compute_score_components(weights, biases)` — single-pass abs-sum, max, and second-max over flat weight and bias arrays
  - `scan_max_weight(weights, biases, exclude_idx, new_weight)` — find max and second-max after a weight change, excluding one index
  - `scan_max_bias(weights, biases, exclude_idx, new_bias)` — find max and second-max after a bias change, excluding one index
- **TypeScript integration** (`Score.ts`): `computeAndCacheScoreComponents` and `scanMaxForWeightChange`/`scanMaxForBiasChange` now delegate to WASM when available, with full TypeScript fallback
- **Wrappers** in `WasmModuleLoader.ts` and `WasmStandaloneFunctions.ts` following existing function pointer patterns
- Uses f64 precision throughout to ensure exact parity with TypeScript — all 3934 existing tests pass unchanged

### Design Decisions

- **f64 over f32**: Initial implementation used f32 (Float32Array) for SIMD vectorisation, but this caused precision mismatches with TypeScript's f64 `number` type in the incremental update path. Switched to f64 to ensure exact bit-for-bit parity.
- **Squash complexity stays in TS**: The `squashComplexityPenalty` computation requires the neuron type registry which cannot be moved to WASM. Only the weight/bias statistics portion is migrated.
- **Index-based exclusion**: WASM scan functions use index-based exclusion (cleaner than the TS value-matching approach), with `findIndex` to locate the exclusion target.

## Evidence

This is a backend/computational change with no visual output. Evidence is provided via:
- All 3934 existing tests pass unchanged (including score parity tests)
- 8 new WASM-specific tests verify correctness
- Benchmark results on large networks (505-860 neurons, 55K-136K synapses)

### Benchmark Results

```
Creature sizes:
  Large: 505 neurons, 55500 synapses
  Very Large: 860 neurons, 136000 synapses

Cold-Cache Score Computation (Full Scan):
  Large creature:     158.17us per iteration
  Very large creature: 291.88us per iteration
```

## Test Plan

- 8 new tests in `test/score/WasmScoreScan.ts`:
  - `compute_score_components available` — verifies WASM function returns correct total, count, max, second-max
  - `compute_score_components empty arrays` — edge case with empty weight array
  - `scan_max_weight basic` — verifies correct max/second-max after weight exclusion
  - `scan_max_bias basic` — verifies correct max/second-max after bias exclusion
  - `score calculation with WASM produces finite results` — end-to-end scoring
  - `score consistent across cache invalidations` — cache round-trip consistency
  - `larger creature score is finite` — stress test on 85-neuron creature
  - `compute_score_components with many elements` — 150-element precision test
- All existing score tests pass unchanged (69 tests across 10 files)
- New benchmark in `bench/WasmScoreScan.ts`
