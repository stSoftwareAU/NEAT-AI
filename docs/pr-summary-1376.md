## Summary

Performance optimisation for issue #1376: "Move backward pass inner loop to
WASM (fused propagate)".

Implemented a batch `safe_zone_adjustment_batch()` WASM function that processes
all eligible synapses in a single boundary crossing, replacing S individual
scalar WASM calls with 1. Integrated this into `Neuron.propagate()` using a
hybrid threshold: batch WASM for >=64 eligible synapses, scalar WASM calls for
smaller counts.

### Changes

**Rust/WASM** (`wasm_activation/src/safe_zone.rs`, `lib.rs`):
- Added `apply_safe_zone_adjustment_batch()` that takes typed arrays of squash
  types, raw inputs, and weights, processing all synapses in a single call
- Exported as `safe_zone_adjustment_batch()` via `#[wasm_bindgen]`
- Added 3 Rust unit tests verifying batch/scalar parity

**TypeScript bridge** (`src/wasm/WasmActivation.ts`, `ActivationMethods.ts`,
`mod.ts`):
- Added `wasmSafeZoneAdjustmentBatch()` low-level binding
- Added `safeZoneAdjustmentBatch()` high-level wrapper
- Wired into both async and sync WASM init paths

**Neuron.propagate() inner loop** (`src/architecture/Neuron.ts`):
- Restructured into a two-pass approach:
  1. Pass 1: Cache activations/weights and identify eligible synapses
  2. Pass 2: Batch WASM call for >=64 eligible synapses; scalar calls otherwise
- Eliminates per-synapse boundary crossing overhead for neurons with many
  inbound connections (common in evolved NEAT networks)

### Hybrid threshold rationale

Benchmarking revealed that TypedArray allocation overhead makes batch calls
slower than scalar for small synapse counts. The crossover point is ~100
synapses; the threshold is set conservatively at 64 to ensure the batch path
is only used where it provides clear benefit.

| Synapse count | Batch vs scalar | Winner |
| ------------- | --------------- | ------ |
| 10            | 3.67x slower    | Scalar |
| 50            | 1.14x slower    | Scalar |
| 200           | 1.47x faster    | Batch  |
| 1000          | 1.67x faster    | Batch  |
| 5000          | 1.29x faster    | Batch  |

## Evidence

Benchmark file: `bench/SafeZoneBatch.ts`

```
group safe-zone-batch-10-synapses
| Batch safe zone (10 synapses)    |  1.13 µs |
| Scalar safe zone (10 synapses)   |  0.31 µs |

group safe-zone-batch-50-synapses
| Batch safe zone (50 synapses)    |  1.72 µs |
| Scalar safe zone (50 synapses)   |  1.51 µs |

group safe-zone-batch-200-synapses
| Batch safe zone (200 synapses)   |  4.73 µs |
| Scalar safe zone (200 synapses)  |  6.96 µs |

group safe-zone-batch-1000-synapses
| Batch safe zone (1000 synapses)  | 20.40 µs |
| Scalar safe zone (1000 synapses) | 34.04 µs |

group safe-zone-batch-5000-synapses
| Batch safe zone (5000 synapses)  | 106.0 µs |
| Scalar safe zone (5000 synapses) | 137.0 µs |
```

This is a backend/CLI change with no visual output - no screenshots applicable.

## Test Plan

- All 2227 existing tests pass (verified via `./quality.sh`)
- New test file: `test/wasm/SafeZoneAdjustmentBatch.ts` (9 test cases)
  - WASM initialisation
  - Empty batch returns empty result
  - Single element matches scalar
  - Mixed squash types match scalar calls
  - Aggregate functions return zero
  - High-level wrapper matches low-level for all common squash types
  - Non-finite raw input returns zero
  - Negative error with saturated neurons
  - Large batch (100 synapses) matches scalar
- Benchmark added: `bench/SafeZoneBatch.ts`
- Rust unit tests added in `wasm_activation/src/lib.rs`
