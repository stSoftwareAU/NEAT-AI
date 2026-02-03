## Summary

Implemented WASM compilation caching for creatures with identical topologies to
improve activation performance for large populations.

### Changes

1. **New file: `src/wasm/WasmCompilationCache.ts`**
   - Implements topology-based caching of WASM binary templates
   - LRU eviction when cache is full (default 100 entries)
   - Statistics tracking for cache hit/miss rates
   - The cache stores structural templates (buffer layout, offsets) and reuses
     them across creatures with the same topology, only updating weights/biases
     for each creature

2. **Updated `src/Creature.ts`**
   - `activateWasm()` and `activateAndTraceWasm()` now use the global cache via
     `getOrCompileWasmModule()`
   - `clearCache()` now invalidates the `topologyHash` when structure changes,
     ensuring cache correctness after mutations

3. **Updated `src/wasm/mod.ts`**
   - Exports new cache functions: `getOrCompileWasmModule`,
     `clearWasmCompilationCache`, `getWasmCompilationCacheStats`, etc.

### How It Works

The topology hash (already used for evaluation deduplication) is used as the
cache key. Creatures with the same neuron UUIDs and connection structure share
the same topology hash, which typically includes:

- Cloned creatures (same parent, before structural mutation)
- Offspring from breeding operations
- Species members with identical structures

The cache stores a pre-built binary template buffer for each unique topology.
When compiling a creature:

1. Look up the topology hash in the cache
2. If found (hit): copy the template buffer and only update weight/bias values
3. If not found (miss): build the full template, cache it, then update weights

## Evidence

### Benchmark Results

```
Topology verification:
  Same topology creatures have same hash: true
  Different topology creatures have 10 unique topologies

Benchmark configuration:
  Population size: 50 creatures
  Network size: 10 inputs, 20 hidden, 3 outputs

group compilation
| Direct compilation - same topology             |        362.5 µs |
| Cached compilation - same topology             |        310.8 µs |

summary: Direct compilation is 1.17x slower than Cached compilation

group full-cycle
| Full activation cycle - same topology          |        383.6 µs |
| Full activation cycle - different topologies   |        598.2 µs |

summary: Same topology is 1.56x faster than different topologies

Cache stats (same topology):
  Hits: 49
  Misses: 1
  Hit rate: 98.0%
```

### Key Performance Metrics

- **17% faster** compilation for creatures with same topology
- **98% cache hit rate** for populations of cloned creatures
- **56% faster** full activation cycle for same-topology populations compared to
  varied topologies

The performance improvement is most significant for:

- NEAT populations during early evolution (many clones before structural
  mutations)
- Species with similar topologies
- Repeated activation of the same creature structure

## Test Plan

- Added unit tests in `test/wasm/WasmCompilationCache.ts`:
  - `WasmCompilationCache: same topology returns cached module` - verifies cache
    hit for clones
  - `WasmCompilationCache: different topology returns different module` -
    verifies cache miss for different structures
  - `WasmCompilationCache: LRU eviction when cache is full` - verifies eviction
    behaviour
  - `WasmCompilationCache: invalidate clears specific entry` - verifies manual
    invalidation
  - `WasmCompilationCache: clear removes all entries` - verifies cache clearing
  - `WasmCompilationCache: topology hash invalidated on mutation` - verifies
    hash invalidation after structural changes
  - `WasmCompilationCache: different squash functions create different cache entries` -
    verifies squash is part of topology
  - `WasmCompilationCache: cache statistics track correctly` - verifies hit/miss
    counting
  - `WasmCompilationCache: works with minimal creatures` - verifies edge case
    handling

All 1823 existing tests continue to pass.

## References

- Closes #1301
- Related: #1013 (Cache compiled activation functions)
- Related: #1031 (Cache compiled activation functions)
- Related: #1016 (Topology hash for evaluation deduplication)
