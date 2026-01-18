# WASM Activation Prototype - Issue #1116

## Summary

This PR implements a prototype WASM-based activation system for the NEAT-AI neural network library. The goal was to evaluate whether WebAssembly can provide significant performance improvements over the existing dynamically-generated JavaScript activation functions.

### Key Findings

**✅ WASM provides a 9.54x performance improvement** over the existing JS-based activation for networks using standard squash functions.

| Implementation | Time/iter (avg) | Iterations/sec | Speedup |
|----------------|-----------------|----------------|---------|
| JS Activation | 62.4 ms | 16.0 | baseline |
| WASM Activation | 6.5 ms | 152.7 | **9.54x** |
| WASM Batch Activation | 6.5 ms | 152.9 | **9.54x** |

Benchmark configuration: 100 inputs, 200 hidden neurons, 10 outputs, 7830 synapses, 1000 activations per iteration.

### Implementation Details

The prototype includes:

1. **Rust WASM Module** (`wasm_activation/`)
   - Implements all 32 standard squash functions (ReLU, TANH, LOGISTIC, SELU, etc.)
   - Uses compact binary format for network serialisation
   - Supports both individual and batch activation

2. **TypeScript Integration** (`src/wasm/`)
   - `CompileToWasm.ts`: Serialises Creature to compact binary format
   - `WasmActivation.ts`: Wrapper for WASM activation
   - `SquashType.ts`: Enum mapping between JS and WASM squash types

3. **Tests and Benchmarks**
   - `test/WasmActivation.ts`: Unit tests verifying correctness
   - `bench/ActivateWasm.ts`: Performance benchmark

### Known Limitations

The current prototype does **not** support aggregate activation functions:
- `IF` (conditional branching with synapse types)
- `MINIMUM`, `MAXIMUM`, `MEAN` (multi-input aggregation)
- `HYPOT` (hypotenuse calculation)

These functions use synapse types (condition, positive, negative) that require special handling beyond simple squash operations. Supporting them would require significant additional work to:
1. Encode synapse types in the binary format
2. Implement conditional logic in WASM
3. Handle multi-input aggregation patterns

### Recommendations for Full Implementation

If proceeding with full WASM implementation, the following phases are recommended:

**Phase 1: Core WASM Infrastructure**
- Set up automated WASM build pipeline (CI/CD)
- Add WASM module to npm/deno package distribution
- Implement automatic fallback to JS when WASM unavailable

**Phase 2: Aggregate Function Support**
- Extend binary format to include synapse types
- Implement IF conditional logic in WASM
- Implement MINIMUM, MAXIMUM, MEAN, HYPOT aggregation

**Phase 3: Production Integration**
- Add WASM activation option to Creature class
- Implement hybrid mode (WASM for supported, JS for aggregate)
- Add configuration options for activation method selection

**Phase 4: Optimisation**
- Explore SIMD instructions for batch processing
- Consider shared memory for zero-copy input/output
- Profile and optimise hot paths

## Evidence

### Benchmark Results

```
CPU | Apple M4 Pro
Runtime | Deno 2.6.4 (aarch64-apple-darwin)

| benchmark               | time/iter (avg) |        iter/s |      (min … max)      |
| ----------------------- | --------------- | ------------- | --------------------- |
| JS Activation           |         62.4 ms |          16.0 | (  9.2 ms … 183.1 ms) |
| WASM Activation         |          6.5 ms |         152.7 | (  6.3 ms …   7.4 ms) |
| WASM Batch Activation   |          6.5 ms |         152.9 | (  6.3 ms …   7.1 ms) |

summary
  WASM Batch Activation
     1.00x faster than WASM Activation
     9.54x faster than JS Activation
```

### Test Results

All unit tests pass:
```
ok | 10 passed | 0 failed | 1 ignored (17ms)
```

The ignored test (`Large traced creature`) documents the aggregate function limitation.

## Test Plan

- Added `test/WasmActivation.ts` with tests for:
  - Module initialisation
  - Squash function mapping
  - Standalone squash function verification
  - Simple ReLU network activation
  - Multiple squash function network
  - Constant neuron handling
  - Batch activation
  - Input validation
  - Resource cleanup (free/dispose)
- Added `bench/ActivateWasm.ts` for performance comparison

## Files Changed

### New Files
- `wasm_activation/` - Rust WASM module
  - `Cargo.toml` - Rust package configuration
  - `src/lib.rs` - WASM activation implementation
  - `build.sh` - Build script
  - `pkg/` - Built WASM artifacts
- `src/wasm/` - TypeScript integration
  - `mod.ts` - Module exports
  - `CompileToWasm.ts` - Creature to binary serialisation
  - `SquashType.ts` - Squash type enum
  - `WasmActivation.ts` - WASM wrapper class
- `test/WasmActivation.ts` - Unit tests
- `bench/ActivateWasm.ts` - Performance benchmark
- `docs/pr-summary-1116.md` - This summary

## Conclusion

The prototype successfully demonstrates that **WASM can provide nearly 10x performance improvement** for neural network activation. This validates the feasibility of a full WASM implementation.

The recommendation is to proceed with full implementation if:
1. The 9.54x speedup provides meaningful value for the use case
2. The additional complexity of maintaining Rust/WASM code is acceptable
3. Aggregate function support can be added in a follow-up phase

A negative result note: Batch activation did not provide additional speedup over individual WASM calls (both ~6.5ms), suggesting the JS/WASM boundary overhead is minimal with wasm-bindgen.
