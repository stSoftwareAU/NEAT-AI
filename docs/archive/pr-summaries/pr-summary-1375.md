## Summary

Research and benchmarking for issue #1375: "Could we move more logic to
Rust/WASM?"

Studied the evolution, training and scoring processes to determine whether
moving more TypeScript logic to Rust/WASM would improve performance. Created
benchmarks to measure WASM boundary crossing overhead during backpropagation and
evaluated a batch approach for reducing crossings.

### What was already WASM-optimised

| Component                 | Status        | Details                         |
| ------------------------- | ------------- | ------------------------------- |
| Forward pass (activation) | Fully WASM    | SIMD, batching, zero-copy       |
| Loss functions            | Fully WASM    | Fused activate+loss, 8-way SIMD |
| Squash/derivative/error   | Fully WASM    | All 38 activation functions     |
| Safe zone adjustment      | WASM (scalar) | Per-call during backprop        |

### What remains in TypeScript

| Component                           | Calls per sample    | Overhead                  |
| ----------------------------------- | ------------------- | ------------------------- |
| `Neuron.propagate()` recursive loop | O(neurons)          | Loop control + allocation |
| `wasmSafeZoneAdjustment()` scalar   | O(synapses)         | ~8.7ns per call           |
| `wasmCalculateError()` scalar       | O(neurons)          | ~9.1ns per call           |
| `wasmSquash()` scalar               | O(neurons)          | ~7.6ns per call           |
| Weight/bias accumulation            | O(synapses)         | Pure TS arithmetic        |
| Elastic error distribution          | O(synapses)         | Pure TS arithmetic        |
| Temporary array allocation          | 5 arrays per neuron | GC pressure               |

### Benchmark results (Apple M4 Pro, Deno 2.6.8)

**Network: 800 neurons, 5000 synapses (6,600 WASM calls per backward pass)**

| Benchmark                         | Time     | Notes                           |
| --------------------------------- | -------- | ------------------------------- |
| Full backward WASM overhead       | 65.1 µs  | All scalar calls combined       |
| safeZoneAdjustment (5000 calls)   | 45.7 µs  | Dominant cost (76%)             |
| calculateError (800 calls)        | 7.3 µs   |                                 |
| squash (800 calls)                | 6.1 µs   |                                 |
| TS arithmetic baseline (5000 ops) | 3.5 µs   | Same loop, no WASM              |
| **WASM/TS overhead ratio**        | **~13x** | Per-call boundary crossing cost |

### Batch approach (negative result)

Implemented and benchmarked `safe_zone_adjustment_batch()` in Rust - a function
that processes all synapses in a single WASM boundary crossing using typed
arrays.

**Result: 3.5x SLOWER than individual scalar calls.**

The `js_sys::Float32Array::new_with_length()` allocation and
`get_index()`/`set_index()` overhead in wasm-bindgen exceeds the boundary
crossing savings. V8/Deno's WASM-to-JS bridge is already highly optimised for
scalar calls (~8.7ns each).

This batch code was NOT included in the final PR (negative result).

### Conclusion

The current WASM integration is already well-optimised. Individual scalar calls
have minimal overhead (~8.7ns each), and batching via typed arrays is
counter-productive.

The promising direction is moving **entire loops** to WASM (not individual
functions), which would eliminate both boundary crossings AND TypeScript
allocation/recursion overhead.

### Sub-issues created

1. **#1376** - Move backward pass inner loop to WASM (fused propagate)
2. **#1377** - Fused backward pass error distribution in WASM
3. **#1378** - Pre-compute squash type indices in creature compilation
4. **#1379** - Reduce TypeScript allocation in backward pass inner loop

## Evidence

Benchmark file: `bench/BackpropWasmOverhead.ts`

```
group backward-pass
| Full backward WASM overhead (800N/5000S)   |  65.1 µs |  15,360 iter/s |

group component-breakdown
| calculateError only (800 calls)            |   7.3 µs | 137,000 iter/s |
| safeZoneAdjustment only (5000 calls)       |  45.7 µs |  21,860 iter/s |
| squash only (800 calls)                    |   6.1 µs | 164,000 iter/s |

group overhead-comparison
| TS arithmetic baseline (5000 ops)          |   3.5 µs | 283,200 iter/s |
| WASM scalar calls (5000 safeZone)          |  45.7 µs |  21,880 iter/s |
```

This is a backend/CLI change with no visual output - no screenshots applicable.

## Test Plan

- All 2218 existing tests pass (verified via `./quality.sh`)
- No new functionality was added (research/benchmark only)
- Benchmark added: `bench/BackpropWasmOverhead.ts`
