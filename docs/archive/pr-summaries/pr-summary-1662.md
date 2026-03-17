## Summary

Benchmark & investigate: Struct-of-arrays synapse storage for typed array
topology. Closes #1662.

This investigation compares the current `Synapse[]` (array-of-structs)
representation with a `CompactSynapseStore` using parallel typed arrays
(`Int32Array` for from/to, `Float64Array` for weight) across 6 key hot paths.

### Feasibility Analysis

All synapse access patterns were categorised across the codebase:

| Pattern                          | Files                                                | Fields Accessed                             |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Sequential scan, filter by `.to` | CreatureTopology, CreatureMutation                   | `.from`, `.to`                              |
| Sequential scan, all fields      | CreatureSerialization, Offspring, Father, Score      | `.from`, `.to`, `.weight`, `.type`, `.tags` |
| Binary search by `from`          | CreatureTopology (outward lookup, disconnect)        | `.from`, `.to`                              |
| Binary search by `to`            | CreatureTopology (inward lookup via secondary index) | `.to`                                       |
| Weight mutation (write)          | NeuronPropagation, ModWeight                         | `.weight`                                   |
| Sort/reorder                     | CreatureSerialization, CreatureTopology              | `.from`, `.to`                              |
| Structural mutation (splice)     | Creature.connect/disconnect                          | —                                           |

### Benchmark Results

Tested on Apple M4 Pro, Deno 2.7.1. Three dataset sizes: small (200 synapses),
medium (2000), large (10000).

| Hot Path                     | Small         | Medium        | Large         | Winner  |
| ---------------------------- | ------------- | ------------- | ------------- | ------- |
| Inward lookup (filter `.to`) | 1.03x obj     | **1.26x SoA** | 1.02x obj     | Mixed   |
| Weight sum (sequential read) | **1.58x SoA** | **1.48x SoA** | **1.45x SoA** | **SoA** |
| Binary search (from, to)     | 1.02x obj     | 1.05x obj     | 1.02x obj     | Object  |
| Full iteration (all fields)  | **1.14x SoA** | **1.62x SoA** | **1.63x SoA** | **SoA** |
| Weight mutation (write)      | **11.1x SoA** | **12.6x SoA** | **11.9x SoA** | **SoA** |
| Build to-index (sort)        | 1.48x obj     | 1.29x obj     | 1.15x obj     | Object  |

### Analysis

**Positive results (SoA wins):**

- **Weight mutation**: 11-12x faster — the most impactful result, as this is the
  innermost backprop loop
- **Sequential reads**: 1.4-1.6x faster — cache-friendly contiguous
  `Float64Array` access
- **Full iteration**: 1.6x faster at scale — benefits breeding/export paths

**Neutral/negative results (Object wins or tie):**

- **Binary search**: ~1.02-1.05x object advantage — V8 already optimises
  monomorphic object property access well for random access patterns
- **Index building**: 1.15-1.48x object advantage — `Array.slice().sort()` is
  faster than index-based scatter into new typed arrays
- **Inward lookup**: Mixed — the scan dominates both approaches equally

### Conclusion

Struct-of-arrays provides a **significant improvement for write-heavy and
sequential-read hot paths** (backprop weight mutation: 11-12x, sequential reads:
1.4-1.6x). However, it shows no benefit for random-access patterns (binary
search) and is slower for structural operations (sort/build index).

**Recommended migration path**: A hybrid approach as suggested in the issue —
maintain `CompactSynapseStore` as a parallel read/write cache for the
weight-heavy backprop path, while keeping `Synapse[]` for structural operations
(mutations, breeding, serialisation). This is compatible with future WASM
integration (#1642) since the typed arrays can be passed directly to WASM
without serialisation.

**Key constraint**: The `.type` and `.tags` fields are only accessed during
structural operations (breeding, export, validation) — never in hot paths. This
means the struct-of-arrays store only needs `from`, `to`, and `weight` arrays,
keeping it simple.

## Evidence

This is a backend performance investigation — no UI changes. Evidence is the
benchmark results above, produced by
`deno bench --allow-read bench/StructOfArraysSynapses.ts`.

## Test Plan

- Added 8 unit tests in `test/architecture/CompactSynapseStore.ts` verifying:
  - `fromArrays` construction and field access
  - `setWeight` mutation
  - `binarySearchFrom` and `binarySearchFromTo` lookups
  - `findByTo` and `findByFrom` collection
  - `sumWeights` accumulation
  - Empty store edge cases
- All 4342 existing tests continue to pass
