## Summary

Migrate the elastic error distribution algorithm to Rust/WASM with SIMD
acceleration. Closes #1519.

### Changes

1. **New Rust module `elastic_distribution.rs`**: Standalone
   `distribute_elastic_error` function implementing the three-pass algorithm
   (activation² scoring with SIMD, weight-based fallback, equal-split last
   resort) with NaN guards and floating-point residue redistribution.

2. **Weight-based fallback added to fused function**: The existing
   `fused_error_distribution` in `fused_error.rs` was missing the weight²
   fallback when activations are near zero. This has been added, matching
   the TypeScript behaviour from `ElasticDistribution.ts`.

3. **TypeScript wrapper**: `wasmDistributeElasticError()` in
   `WasmStandaloneFunctions.ts` provides access to the standalone function.

4. **WASM module loader**: Added function pointer registration and getter
   for `distribute_elastic_error`.

### Benchmark Results

The standalone WASM function shows higher latency than TypeScript due to
WASM boundary crossing overhead (copying Float32Arrays across the JS/WASM
boundary). The fused function (which keeps data in WASM linear memory)
remains the preferred path.

| Benchmark | TS (ns/iter) | WASM (ns/iter) | Ratio |
|-----------|-------------|----------------|-------|
| 10 synapses | 23.6 | 233.7 | TS 9.9x faster |
| 50 synapses | 95.9 | 303.6 | TS 3.2x faster |
| 200 synapses | 424.8 | 597.1 | TS 1.4x faster |
| 1000 synapses | 2,300 | 2,400 | TS 1.04x faster |

The standalone function converges towards parity at large synapse counts
where SIMD computation dominates boundary overhead. The **fused function**
(which avoids boundary crossings by keeping data in WASM memory) remains
the optimal path for backpropagation and now includes the weight-based
fallback.

## Evidence

This is a backend/WASM change with no visual output. Evidence is provided
by benchmark results above and the test results below.

## Test Plan

- **Rust unit tests**: 14 new tests in `elastic_distribution.rs` covering
  all three algorithm paths, edge cases (NaN, Infinity, empty, single link),
  error conservation, and weight fallback variants
- **TypeScript WASM tests**: 13 new tests in `test/wasm/ElasticDistribution.ts`
  verifying WASM results match TS implementation across all code paths
- **Existing tests**: All 3911 existing tests pass unchanged
- **Benchmark**: `bench/ElasticDistribution.ts` comparing TS vs WASM at
  10, 50, 200, and 1000 synapse counts including weight fallback path
