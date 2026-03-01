## Summary

Benchmark and investigate optimising breeding crossover with reduced Map/object
allocation. Closes #1644.

### Optimisations Applied

1. **Father.ts: O(n) to O(1) key matching** — Replaced `Array.from(fatherKeyMap.entries()).filter()` with direct `fatherKeyMap.get(motherKey)` for neuron UUID alignment. The old code iterated all father entries per mother key (O(n) per lookup); the new code uses a single Map lookup (O(1)).

2. **Offspring.ts: Deferred UUID resolution (ConnectionRef)** — Replaced `cloneConnections()` calls that created thousands of `SynapseExport` objects with a `ConnectionRef` type that stores a reference to the parent creature and its internal synapse array. UUIDs are resolved on-the-fly via `parent.neurons[synapse.from].uuid`, eliminating ~8500 intermediate object allocations for medium networks.

3. **Offspring.ts: Numeric connection deduplication keys** — Replaced string-based `"${fromIndx}-${toIndx}"` keys in `connectionSet` with numeric keys (`fromIndx * neuronCount + toIndx`), avoiding string allocation per synapse.

4. **Offspring.ts: Combined iterations** — Merged separate mother neuron iterations for `mumMap` and `childMap` input population into a single pass.

### Benchmark Results (Apple M4 Pro, Deno 2.7.1)

| Network Size | Before | After | Change |
|---|---|---|---|
| Small (~20 neurons, 84 synapses) | 445.9 µs | 439.6 µs | -1.4% |
| Medium (~200 neurons, 8500 synapses) | 45.5 ms | 44.4 ms | -2.4% |
| Large (~520 neurons, 57000 synapses) | 357.2 ms | 351.2 ms | -1.7% |

### Analysis

The ~1-2% improvement is modest, confirming findings from #1632 that breeding
is **data-structure-bound** and V8's Map/object allocation is already highly
optimised. The deferred `ConnectionRef` approach eliminates thousands of
intermediate `SynapseExport` allocations but V8's generational garbage collector
handles short-lived objects efficiently, limiting the visible speedup.

The Father.ts O(n) to O(1) fix is an algorithmic improvement that benefits
real-world workloads where parents have many hidden neurons with different
structural topologies — this is most impactful during parent selection via
`createCompatibleFatherFromCreatures()`.

## Evidence

Benchmark script: `bench/BreedCrossoverAllocation.ts`

No UI changes — this is a backend performance investigation.

## Test Plan

- All 4288 existing tests pass (including breeding, offspring, and father compatibility tests)
- Updated `test/Offspring/SortNeurons.ts` to use `ConnectionRef` type
- Updated `test/architecture/Offspring.ts` to use `ConnectionRef` type
- `Offspring.cloneConnections` retained as public utility with existing tests
- `./quality.sh` passes cleanly
