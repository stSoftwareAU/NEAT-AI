## Summary

Benchmark & investigate: Convert BackpropBuffers remaining JS arrays to
Float64Array — **negative result**. Closes #1658.

Converted `fromActivationCache`, `fromWeightCache`, `fromValueCache`, and
`safeZoneFactorCache` from `number[]` to `Float64Array` in `BackpropBuffers.ts`
and benchmarked the full backward pass on small (44N/288S), medium (117N/910S),
and large (223N/2280S) networks. The conversion showed **no meaningful
improvement** in full backward pass throughput, so the source changes were
reverted. The benchmark is retained as documentation.

## Evidence

### Isolated buffer fill micro-benchmark (reused buffers)

Float64Array is ~39% faster than JS `number[]` for isolated write+read loops on
pre-allocated 50-element buffers:

| Buffer type            | time/iter | iter/s     |
| ---------------------- | --------- | ---------- |
| JS number[] (baseline) | 33.5 ns   | 29,870,000 |
| Float64Array           | 24.1 ns   | 41,520,000 |

### Full backward pass throughput (before vs after conversion)

| Network            | Before (JS arrays) | After (Float64Array) | Change        |
| ------------------ | ------------------ | -------------------- | ------------- |
| Small (44N/288S)   | 60.9 us            | 61.3 us              | +0.7% (noise) |
| Medium (117N/910S) | 216.7 us           | 220.3 us             | +1.7% (noise) |
| Large (223N/2280S) | 569.7 us           | 576.5 us             | +1.2% (noise) |

All results are within measurement noise (~1-2%). The buffer fill/read is a tiny
fraction of total backward pass work, which is dominated by:

- WASM `fusedErrorDistribution` calls
- Graph traversal (`inwardConnections` lookups)
- State access (`adjustedActivation`, `adjustedWeight`, `adjustedBias`)
- Recursive/iterative propagation through the network

### Why no improvement

The four JS `number[]` buffers are already pooled and reused via
`BackpropBuffers` (Issue #1379). While Float64Array offers better cache locality
in isolation, the backward pass inner loop interleaves buffer reads with
expensive operations (WASM calls, object property lookups, function calls) that
dominate the runtime. The buffer access pattern is also sequential
write-then-read with no random access, which JS engines already optimise well
for dense `number[]` arrays.

## Test plan

- All 4334 existing tests pass unchanged (`./quality.sh`)
- Benchmark added: `bench/BackpropFloat64Buffers.ts`
