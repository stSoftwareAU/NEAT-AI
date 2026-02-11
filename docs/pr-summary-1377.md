## Summary

Performance optimisation for issue #1377: "Fused backward pass error
distribution in WASM".

Implemented a single `fused_error_distribution()` WASM function that combines
three backward pass steps — `calculateError()`, per-synapse
`safeZoneAdjustment()`, and elastic error distribution — into one boundary
crossing. This eliminates S+1 WASM calls per neuron and keeps all intermediate
float values in WASM linear memory. The fused path replaces the previous
separate calls unconditionally (no threshold), since the crossover point is ~200
synapses and the overhead for small counts is modest (~10%).

### Changes

**Rust/WASM** (`wasm_activation/src/fused_error.rs`, `lib.rs`):

- New `apply_fused_error_distribution()` combining error calculation, safe zone
  adjustment, and elastic distribution in a single function
- Returns flat `Vec<f32>` with layout
  `[error, safeZone_0..N, perLinkError_0..N]` to minimise WASM boundary overhead
- Includes equal-split fallback for early training (all activations near zero)
  and floating-point residue cleanup
- Exported as `fused_error_distribution()` via `#[wasm_bindgen]`
- Added 4 Rust unit tests (basic identity, zero error, empty synapses, single
  synapse)

**TypeScript bridge** (`src/wasm/WasmActivation.ts`, `ActivationMethods.ts`,
`mod.ts`):

- Added `wasmFusedErrorDistribution()` low-level binding that unpacks the flat
  result into `FusedErrorDistributionResult` (`error`, `safeZoneFactors`,
  `perLinkError`)
- Added `fusedErrorDistribution()` high-level wrapper
- Wired into both async and sync WASM init paths

**Neuron.propagate() backward pass** (`src/architecture/Neuron.ts`):

- Replaced the two-pass approach (separate error calc + batch/scalar safe zone +
  TS elastic distribution) with a single fused WASM call
- Single pass builds typed arrays for all synapses:
  - Self-loops: activation=0, squash=Identity, weight=0 (post-processed to
    safeZone=0)
  - Input/constant neurons: squash=Identity (returns safeZone=1)
  - Eligible neurons: actual squash type and hint values
- Post-processing overrides self-loop safe zone factors to 0 (maintaining
  existing self-connection blocking behaviour)
- `hasUsableSafeZone` fallback still uses `distributeElasticError()` with all
  safeZone=1
- Removed unused imports: `safeZoneAdjustment`, `safeZoneAdjustmentBatch`

### Benchmark results

| Synapse count | Separate vs Fused | Winner   |
| ------------- | ----------------- | -------- |
| 10            | 1.10x faster      | Separate |
| 50            | 1.09x faster      | Separate |
| 200           | 1.07x faster      | Fused    |
| 1000          | 1.34x faster      | Fused    |

The fused approach shows clear wins at higher synapse counts (1.34x at 1000
synapses) where WASM boundary crossing overhead dominates. For small counts the
overhead is negligible (~10%), while the code simplification from a single call
path benefits maintainability.

## Evidence

Benchmark file: `bench/FusedErrorDistribution.ts`

```
group fused-error-10-synapses
| Separate (10 synapses) |  332 ns |
| Fused (10 synapses)    |  366 ns |

group fused-error-50-synapses
| Separate (50 synapses) |  600 ns |
| Fused (50 synapses)    |  655 ns |

group fused-error-200-synapses
| Separate (200 synapses) | 1.9 µs |
| Fused (200 synapses)    | 1.8 µs |

group fused-error-1000-synapses
| Separate (1000 synapses) | 10.5 µs |
| Fused (1000 synapses)    |  7.8 µs |
```

This is a backend/CLI change with no visual output — no screenshots applicable.

## Test Plan

- All 2234 existing tests pass (verified via `./quality.sh`)
- New test file: `test/wasm/FusedErrorDistribution.ts` (7 test cases)
  - WASM initialisation
  - Mixed upstream squash types match separate approach
  - Single synapse gets all error
  - Zero error produces zero shares
  - All saturated fallback to equal split
  - Large batch (100 synapses) matches separate approach
  - Negative error distributes correctly
  - Safe zone factors match separate scalar calls
- Benchmark added: `bench/FusedErrorDistribution.ts`
- Rust unit tests added in `wasm_activation/src/fused_error.rs` (4 tests)
