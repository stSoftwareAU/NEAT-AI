## Summary

Benchmark & investigate: Migrate topological backprop orchestration loop to
Rust/WASM. Closes #1657.

**Result: Negative — WASM migration not justified.**

Profiling the iterative topological backpropagation loop shows that JS overhead
(property lookups, state access, graph traversal) accounts for only ~13% of
total propagation time — well below the 30% threshold that would justify
migration. The WASM boundary crossings are already well-optimised through the
fused error distribution approach (#1377).

## Evidence

### Baseline Benchmark (FusedBackpropPass.ts)

| Benchmark                          | Time/iter | Iter/s |
| ---------------------------------- | --------- | ------ |
| Full backprop - small (44N/204S)   | 61.3 µs   | 16,310 |
| Full backprop - medium (117N/910S) | 244.6 µs  | 4,088  |
| Full backprop - large (223N/2280S) | 624.2 µs  | 1,602  |
| Propagate only - small (44N)       | 50.6 µs   | 19,770 |
| Propagate only - medium (117N)     | 203.8 µs  | 4,908  |
| Propagate only - large (223N)      | 532.0 µs  | 1,880  |

### Profiling Breakdown (TopologicalBackpropProfile.ts)

For the medium network (117 neurons, 910 synapses), full propagate = ~210 µs:

| Component                                   | Time         | % of Total |
| ------------------------------------------- | ------------ | ---------- |
| Topological order computation               | 5.6 µs       | 2.7%       |
| adjustedActivation (all neurons)            | 0.85 µs      | 0.4%       |
| adjustedWeight + adjustedBias (all neurons) | 12.4 µs      | 5.9%       |
| Buffer acquire+fill+release (all neurons)   | 6.2 µs       | 3.0%       |
| WASM fusedErrorDistribution (~112 calls)    | ~33 µs est.  | 15.7%      |
| WASM wasmSquash (~112 calls)                | ~3.9 µs est. | 1.9%       |
| inwardConnections lookups                   | 1.9 µs       | 0.9%       |
| propagateNeeded lookups                     | 0.4 µs       | 0.2%       |
| **Remaining (error logic, accumulation)**   | **~146 µs**  | **~69%**   |

### Why WASM Migration Would Not Help

1. **JS overhead is only ~13%** — property lookups, graph access, and sparse
   checks together account for ~27 µs out of ~210 µs total
2. **WASM calls are already efficient** — fusedErrorDistribution batches
   per-neuron work into single calls (~300 ns each)
3. **Serialisation wall** — migrating the loop would require serialising the
   entire creature state (neurons, connections, sparse config, backprop buffers)
   to WASM memory per propagation call. Prior investigations (#1630, #1632) show
   serialisation costs 50–1,000x more than the computation saved
4. **Sequential dependency** — the loop is inherently sequential (each neuron's
   gradient depends on downstream results), limiting parallelisation gains even
   within WASM

This aligns with the documented findings in `docs/performance-guide.md` under
"Sequential Graph Traversal (Backpropagation Orchestration)".

## Test Plan

- Added `bench/TopologicalBackpropProfile.ts` — profiling benchmark that
  instruments individual components of the topological backprop loop
- Ran existing `bench/FusedBackpropPass.ts` for baseline comparison
- No code changes to production logic — negative result, no implementation
  needed
