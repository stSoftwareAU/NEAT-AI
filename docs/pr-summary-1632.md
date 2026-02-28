## Summary

Investigated migrating breeding/crossover topology reconstruction to Rust/WASM.
Implemented a WASM `breed_topology` function in Rust that handles crossover
selection, missing-neuron resolution, and topological sort. Benchmarked against
the existing TypeScript `Offspring.breed()` at three network sizes (20, 200,
1000+ neurons).

**Result: Negative — no meaningful end-to-end improvement.** Closes #1632.

## Benchmark Results

### Baseline: TypeScript `Offspring.breed()`

| Size | Neurons | Synapses | Time/iter (avg) |
|------|---------|----------|-----------------|
| Small | 20 | 84 | 468 µs |
| Medium | 200 | 8,500 | 47.2 ms |
| Large | 1,070 | 222,000 | 1.7 s |

### WASM Topology Function (Rust, pre-serialised data)

| Size | WASM call only | Serialise + WASM | TS breed |
|------|---------------|------------------|----------|
| Small | 1.5 µs | 264 µs | 468 µs |
| Medium | 48 µs | 23 ms | 47 ms |
| Large | 1.1 ms | 751 ms | 1.7 s |

### Analysis

The WASM topology computation itself is **300x–1600x faster** than the full TS
breed. However, the end-to-end picture is different:

1. **Serialisation overhead dominates**: Converting UUID-keyed `Map<string,
   Neuron>` objects to flat `Uint32Array` for WASM takes 99%+ of the
   "Serialise + WASM" time. The actual Rust computation is negligible.

2. **Incomplete comparison**: The "Serialise + WASM" measurement includes
   `shallowClone()` + `upgrade()` + `inwardConnections()` (which the TS breed
   also performs), but excludes creature reconstruction (neuron creation,
   `connectBatch()`, validation) that the TS breed includes. Adding these back
   would make WASM slower or at best break-even.

3. **Fundamental mismatch**: The breeding algorithm is dominated by
   **string-keyed Map operations** (UUID lookup, connection deduplication) and
   **object construction** (Neuron/Synapse creation). These are not
   WASM-friendly workloads — V8's Map and object allocation are already highly
   optimised. WASM excels at tight numerical loops (activation, gradient
   computation), not graph-structure manipulation with polymorphic objects.

4. **Boundary cost**: Each `Uint32Array` creation involves a copy from JS heap
   to WASM linear memory. For large networks (222k connections), this alone
   accounts for several hundred milliseconds.

### What was tried

- Implemented `breed_topology` in Rust handling crossover selection,
  dependency resolution, and topological sort
- Minimised boundary crossings by passing only numeric indices (UUID→index
  mapping done in JS)
- Used pre-allocated flat arrays to reduce allocation overhead
- Separated the topology call from serialisation to isolate WASM computation speed

### Why it doesn't help

The breeding hot path is not compute-bound — it is **data-structure-bound**.
The existing TypeScript implementation uses:
- `Map<string, Neuron>` with O(1) lookup (V8 hash tables)
- `shallowClone()` instead of JSON (already optimised, Issue #1095)
- Batched `connectBatch()` with single cache invalidation (Issue #1102)
- Pre-built neuron Maps for O(1) lookup (Issue #1024)

These optimisations leave little room for WASM to improve. The
serialisation/deserialisation cost to cross the JS↔WASM boundary eliminates
any speed gain from Rust's faster data structures.

### Future considerations

If creature topology data were persisted in WASM memory (similar to
`CompiledNetwork` for activation), the serialisation cost could be amortised
over multiple breeding operations. This would require a significant
architectural change to keep neuron/synapse data in WASM linear memory and
only cross the boundary for results. This could be explored as part of a
broader "WASM-resident creature" initiative rather than an isolated breeding
migration.

## Evidence

This is a purely backend performance investigation with no UI changes.
Benchmark results above serve as evidence. The benchmark file
`bench/BreedTopologyWasm.ts` is included for reproducibility.

## Test Plan

- Benchmark `bench/BreedTopologyWasm.ts` verifies baseline measurements at
  three network sizes
- No production code changes — existing tests remain unaffected
