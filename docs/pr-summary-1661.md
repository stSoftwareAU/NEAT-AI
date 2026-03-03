## Summary

Benchmark & investigate: Pre-sized typed arrays in propagateUpdate weight
accumulation — **negative result**. Closes #1661.

Investigated replacing `number[]` with `push()` by pre-sized `Float64Array` (and
pre-sized `number[]`) in `propagateUpdate()` for weight accumulation arrays. The
isolated array microbenchmark confirms pre-sized `number[]` with index
assignment is 2.45x faster than `push()`, but the backward pass improvement is
only ~1-3% — well below the 10% threshold for merging.

Key finding: `Float64Array` was actually **1.6x slower** than `number[]` with
`push()` on Deno/V8, contrary to the hypothesis that typed arrays would be
faster.

## Evidence

### Backward pass (full propagate — what matters)

| Network            | Baseline | After change | Change       |
| ------------------ | -------- | ------------ | ------------ |
| Small (44N/288S)   | 66.0 µs  | 64.0 µs      | ~3% faster   |
| Medium (117N/910S) | 212.6 µs | 212.2 µs     | ~0.2% faster |
| Large (223N/2280S) | 550.1 µs | 540.4 µs     | ~1.8% faster |

### Isolated array allocation (microbenchmark)

| Pattern                        | Time     | vs push()        |
| ------------------------------ | -------- | ---------------- |
| `number[]` push()              | 95.8 ns  | baseline         |
| `number[]` indexed (pre-sized) | 39.1 ns  | **2.45x faster** |
| `Float64Array` indexed         | 153.1 ns | 1.60x **slower** |

### Why no meaningful improvement

`propagateUpdate()` runs once per non-input neuron per backward pass, but is a
tiny fraction of the total cost. The backward pass is dominated by recursive
`propagate()` calls and WASM fused error distribution. The ~2.45x array
allocation speedup gets diluted to noise at the system level.

## Test Plan

- Benchmark added: `bench/PropagateUpdateTypedArrays.ts`
- No source code changes (negative result — source reverted)
- All existing tests continue to pass
