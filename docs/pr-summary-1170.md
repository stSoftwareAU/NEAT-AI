# PR Summary: WASM Performance Analysis and Issue Creation (#1170)

## Summary

This PR addresses issue #1170 by conducting a comprehensive analysis of why the
WASM implementation is ~2.19× slower than the JavaScript implementation for
neural network activation, despite WASM being intended as a performance
improvement.

The analysis identified the root cause: **JS uses JIT-compiled code generation**
that gets highly optimised by V8, while **WASM uses a generic interpreter loop**
with significant overhead.

## Root Cause Analysis

### JS Implementation (Fast - 60.5s for 2.16M activations)

The JS implementation generates specialised code at runtime:

```javascript
// Generated code with constants inlined
const t5 = 0.123 + a[0] * 0.5 + a[1] * -0.3;
a[5] = t5 > 0 ? t5 : 0; // ReLU inlined
```

Benefits:

- Constant folding (weights/biases are literals)
- Inlined activation functions
- V8 JIT compilation to native code
- No loop overhead

### WASM Implementation (Slow - 132.6s for 2.16M activations)

The WASM implementation uses an interpreter loop:

```rust
for neuron in neurons {
    for synapse in synapses {
        sum += activations[from] * weight;
    }
    activation = apply_squash(squash_type, sum);  // 35-arm match
}
```

Overhead:

- Tuple unpacking per neuron/synapse
- 35-arm match statement per activation
- f64 ↔ f32 conversions
- Per-call memory allocations

## Issues Created

### Quick Wins (Low Complexity, 15-40% combined improvement)

1. **#1171** - Per-call Float32Array allocation overhead in activate()
2. **#1172** - activateAndTrace() copies data element-by-element
3. **#1173** - activate_and_trace() allocates Vec<f32> on every call

### Medium Complexity (20-35% improvement potential)

4. **#1175** - Use typed structs instead of tuples
5. **#1176** - Batch activation mode to reduce JS/WASM crossings
6. **#1177** - Specialise activation paths for common squash functions

### High Complexity, High Impact

7. **#1178** - WASM SIMD for parallel synapse processing (30-50% potential)
8. **#1179** - WASM code generation to match JS JIT (parity or better)

## Evidence

### Benchmark Data (from docs/wasm-vs-js-scoring-grq.md)

| Metric         | WASM   | JS    | Difference     |
| -------------- | ------ | ----- | -------------- |
| Time           | 132.6s | 60.5s | 2.19× slower   |
| Per-activation | 61μs   | 28μs  | +33μs overhead |

### Files Analysed

- `wasm_activation/src/lib.rs` - Rust WASM implementation (3,661 lines)
- `src/wasm/WasmActivation.ts` - TypeScript bindings (737 lines)
- `src/wasm/CompileToWasm.ts` - Creature compilation (191 lines)
- `src/optimize/MakeCreatureActivationFunction.ts` - JS code generation
- `docs/wasm-vs-js-scoring-grq.md` - Benchmark results

### Production Creature Stats

- Observations: 1,556 inputs
- Neurons: 736 (non-input)
- Synapses: 18,201
- Records evaluated: 2,160,230

## Recommended Priority Order

1. **Quick wins first**: #1171, #1172, #1173
2. **Struct refactoring**: #1175 (enables further optimisations)
3. **Squash specialisation**: #1177
4. **Batch mode**: #1176
5. **SIMD investigation**: #1178
6. **Code generation**: #1179 (ultimate solution)

## Test Plan

This PR creates GitHub issues only - no code changes. The issues created
contain:

- Detailed problem descriptions
- Proposed solutions with code examples
- Expected impact estimates
- Related issue links

Each subsequent PR implementing these issues should include:

- Benchmark results comparing before/after
- Unit tests verifying correctness parity with JS
