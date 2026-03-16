## Summary

Investigated whether migrating backpropagation gradient computation to Rust/WASM
would improve performance. Created comprehensive benchmarks measuring the full
backprop pass across different network sizes (44–223 neurons, 204–2280
synapses). **Result: negative — no meaningful improvement possible.** Closes
#1630.

## Benchmark Results

### Full Backpropagation Pass (per training sample)

| Network | Neurons | Synapses | Time/iter (avg) |
| ------- | ------- | -------- | --------------- |
| Small   | 44      | 204      | 123.2 µs        |
| Medium  | 117     | 910      | 4.8 ms          |
| Large   | 223     | 2,280    | 167.5 ms        |

### Where Time is Spent (Medium Network)

| Component                               | Time    | % of Total |
| --------------------------------------- | ------- | ---------- |
| Full propagate (error + accumulate)     | 4.7 ms  | 100%       |
| Error distribution only (no accumulate) | 4.3 ms  | 91%        |
| Weight/bias accumulation overhead       | ~0.4 ms | ~9%        |
| WASM boundary crossings (estimated)     | ~15 µs  | ~0.3%      |

### WASM Boundary Crossing Overhead (from Issue #1375 benchmark)

| Metric                           | Value              |
| -------------------------------- | ------------------ |
| Per WASM call overhead           | ~10 ns             |
| 6,600 calls (800N + 5000S) total | 65.6 µs            |
| TS arithmetic vs WASM scalar     | 13.1x faster in TS |

### Environment

- CPU: Apple M4 Pro
- Runtime: Deno 2.7.1 (aarch64-apple-darwin)

## Analysis

The hypothesis was that a fused backpropagation pass in Rust (processing all
neurons in one WASM call per sample) could reduce JS↔WASM boundary-crossing
overhead and enable SIMD across neurons/synapses.

**Why this doesn't work:**

1. **WASM boundary crossings account for only ~0.3% of total backprop time.**
   Even eliminating ALL boundary crossings would save microseconds in a
   millisecond-scale operation.

2. **90% of backprop time is in the recursive graph traversal** — the TypeScript
   orchestration loop that walks the network topology backward, manages caches,
   and checks sparse configuration. This is inherently sequential and cannot
   benefit from SIMD.

3. **Weight/bias accumulation is only ~9% of total time.** Existing WASM batch
   functions (4-way and 8-way) already minimise the per-synapse overhead.

4. **The fused error distribution (Issue #1377) already eliminated the biggest
   source of boundary crossings** by combining calculateError + safeZone +
   elastic distribution into a single WASM call per neuron.

5. **Implementing the full recursive backprop traversal in Rust would be
   extremely complex** — it requires handling dynamic NEAT topology, sparse
   neuron selection, activation caching, bias-weight coordination, and learning
   rate strategies. The maintenance burden far outweighs the theoretical <1%
   performance gain.

## Learnings

- The current WASM integration is already well-optimised: individual operations
  (squash, error calculation, accumulation) are in WASM, and the fused error
  distribution eliminates the main per-neuron overhead.
- For future performance work on backpropagation, the bottleneck is the
  recursive graph traversal algorithm itself (O(neurons × depth) complexity),
  not the WASM boundary crossings. Algorithmic improvements (e.g., topological
  ordering for single-pass traversal, or reducing revisits) would be more
  impactful than WASM migration.
- The persistent training state infrastructure (Issue #1522) provides the
  foundation for keeping accumulators in WASM memory, which is already
  implemented and available for future integration.

## Evidence

This is a backend/performance investigation with no UI changes. Evidence is the
benchmark results shown above, captured from `bench/FusedBackpropPass.ts` and
`bench/BackpropWasmOverhead.ts`.

## Test Plan

- Added `bench/FusedBackpropPass.ts` — comprehensive benchmark measuring full
  backprop pass for small, medium, and large networks with sparse connectivity
- No unit tests modified (negative result — no code changes to test)
