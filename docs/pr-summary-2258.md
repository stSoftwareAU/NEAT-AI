## Summary

Optimise `getTopologyHash` by replacing JSON.stringify with delimiter-separated
string keys and caching the neuron topology portion across connection-only
structural changes. Closes #2258.

### Changes

1. **String-based hashing** (`CreatureUtils.ts`): Replace object allocation +
   `JSON.stringify` with tab-delimited string keys for both neurons and synapses.
   Uses a flat `string[]` UUID lookup instead of `Map<number, string>`.

2. **Incremental neuron caching** (`Creature.ts`): Cache the sorted neuron
   topology key (`_cachedNeuronTopologyKey`) and UUID lookup array
   (`_cachedUuidLookup`) on the creature instance. These are preserved across
   connection-only invalidations (`clearConnectionCaches`,
   connection-only `clearCache`) but cleared on full topology invalidation
   (neuron add/remove).

3. **Benchmark** (`bench/IncrementalTopologyHash.ts`): Micro-benchmark comparing
   old (JSON-based) vs new (string-key-based) hash computation at three creature
   sizes, with both full-recompute and incremental (connection-only change)
   scenarios.

## Evidence

### Benchmark Results

| Scenario | Size | OLD (baseline) | NEW | Speedup |
|----------|------|---------------|-----|---------|
| Full recompute | Small (23n, 115s) | 72.7 µs | 26.3 µs | **2.77x** |
| Full recompute | Medium (110n, 2.8k s) | 2.1 ms | 582 µs | **3.56x** |
| Full recompute | Large (520n, 57k s) | 54.3 ms | 16.9 ms | **3.21x** |
| After conn change | Small | 72.9 µs | 24.3 µs | **3.00x** |
| After conn change | Medium | 2.1 ms | 571 µs | **3.63x** |
| After conn change | Large | 53.6 ms | 16.9 ms | **3.18x** |

The **3x speedup** comes primarily from eliminating JSON.stringify and object
allocation overhead. The incremental neuron caching adds a small additional
benefit for smaller creatures; for large creatures the synapse sort dominates.

### Key finding

The original hypothesis (incremental caching of neuron data) provides marginal
benefit because synapse processing dominates for large creatures. The larger win
is the algorithmic change from JSON serialisation to string-key concatenation,
which benefits all recomputations regardless of whether they are incremental.

## Test Plan

- Updated `test/architecture/TopologyHashDirectCompute.ts` — verifies
  determinism, cross-copy consistency, weight-independence, constant neuron
  handling, multi-output support, different-topology differentiation, and
  incremental cache consistency
- Existing `test/architecture/TopologyHash.ts` — all 7 tests pass unchanged
  (basic generation, same-topology/different-weights, different topology,
  different connections, order independence, caching, invalidation)
- Full quality gate: 5731 tests passed, 0 failed
