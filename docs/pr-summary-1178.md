## Summary

Implements WASM SIMD optimisations for parallel synapse processing (Issue #1178).

### Changes

1. **Dual-accumulator weighted sum** (`simd.rs`): Upgraded `weighted_sum_simd` from a single-accumulator (4 synapses/iteration) to a dual-accumulator approach (8 synapses/iteration). Two independent `f32x4` accumulators hide FMA latency by allowing out-of-order execution of independent dependency chains. Falls back to single-accumulator for counts 4-7 and scalar for < 4.

2. **SIMD aggregate function helpers** (`simd.rs`):
   - `weighted_sum_of_squares_simd` — SIMD-accelerated sum-of-squared-weighted-activations for the Hypotenuse squash function
   - `weighted_sum_of_squares_v2_simd` — SIMD-accelerated variant for HypotenuseV2 (bias + activation * weight)^2
   - `weighted_sum_no_bias_simd` — SIMD-accelerated plain weighted sum (no bias) for the Mean squash function

3. **Network integration** (`network.rs`): Updated `activate()`, `activate_into()`, and `activate_and_trace()` to use the new SIMD aggregate helpers for Hypotenuse, HypotenuseV2, and Mean squash functions — replacing their previous scalar loops.

4. **Comprehensive Rust tests** (`simd.rs`): Added 19 unit tests covering all SIMD functions:
   - `weighted_sum_simd`: empty, 1/3/4/5/8/25 synapses, offset ranges, negative values
   - `weighted_sum_of_squares_simd`: empty, basic, SIMD path
   - `weighted_sum_no_bias_simd`: empty, basic
   - `weighted_sum_of_squares_v2_simd`: basic, SIMD path
   - `weighted_sum_simd_4records`: basic, empty
   - `weighted_sum_simd_8records`: basic, empty

5. **Benchmark** (`bench/SimdSynapseProcessing.ts`): New Deno benchmark exercising SIMD synapse processing at different network sizes and synapse densities.

### Architectural decisions

- **f32 precision retained**: All computation uses f32 (4-wide SIMD) rather than f64 (2-wide). This was already the established approach and provides better parallelism.
- **AoS layout preserved**: The existing Array-of-Structures layout for `SynapseData` is maintained. While SoA (Structure-of-Arrays) could enable contiguous SIMD loads for weights, the scattered activation gather pattern (via `from_index`) is the true bottleneck, so restructuring data layout would add complexity without proportional benefit.
- **Dual accumulator over unrolling**: Rather than simple loop unrolling, the dual-accumulator approach specifically targets FMA pipeline latency by maintaining two independent accumulation chains.

## Evidence

Benchmark results on Apple M4 Pro (Deno 2.6.7, WASM SIMD):

```
group synapse-processing
| Small (5 syn/neuron, scalar path)       |        195.2 us |
| Medium (25 syn/neuron, SIMD dual-acc)   |        285.8 us |
| Large (25 syn/neuron, 736 hidden)       |        381.8 us |

group activate-into
| Medium activateInto (zero-alloc)        |        246.4 us |
| Large activateInto (zero-alloc)         |        336.4 us |
```

The SIMD paths scale linearly with network size. The dual-accumulator approach is most beneficial for neurons with >= 8 synapses (the production average of ~25 synapses per neuron falls well within this range).

Note: Since this is a new SIMD implementation rather than a before/after comparison, there is no pre-existing scalar-only WASM baseline to compare against — the previous WASM already used single-accumulator SIMD (Issue #1178 initial work). The dual-accumulator improvement primarily reduces pipeline stalls which are difficult to measure in isolation.

## Test Plan

- 19 new Rust unit tests in `wasm_activation/src/simd.rs` verifying:
  - `weighted_sum_simd` correctness across all code paths (scalar fallback, single-accumulator, dual-accumulator, remainder handling)
  - `weighted_sum_of_squares_simd` for Hypotenuse
  - `weighted_sum_of_squares_v2_simd` for HypotenuseV2
  - `weighted_sum_no_bias_simd` for Mean
  - `weighted_sum_simd_4records` and `weighted_sum_simd_8records` for batch processing
- All 121 Rust tests pass (`cargo test`)
- All 1747 Deno tests pass (`./quality.sh`)
- New benchmark: `bench/SimdSynapseProcessing.ts`
