## Summary

Replace topology cache `Map<number, Synapse[]>` with flat indexed arrays
`(Synapse[] | undefined)[]` for `cacheTo`, `cacheFrom`, and `cacheSelf` in
`CreatureTopology.ts`. Since neuron indices are dense integers in range
`[0, neuronCount)`, direct array indexing eliminates Map hash computation and
bucket traversal overhead. Closes #1660.

## Evidence

Benchmark results on Apple M4 Pro (1001 neurons, 2448 synapses):

| Benchmark                  | Before (Map) | After (Array) | Improvement    |
| -------------------------- | ------------ | ------------- | -------------- |
| inward lookups (cached)    | 4.9 µs       | 2.9 µs        | **41% faster** |
| outward lookups (cached)   | 16.5 µs      | 8.0 µs        | **52% faster** |
| inward lookups (rebuild)   | 752.6 µs     | 741.7 µs      | ~1% faster     |
| outward lookups (rebuild)  | 285.6 µs     | 247.2 µs      | **13% faster** |
| partial invalidation cycle | 206.4 µs     | 203.2 µs      | ~2% faster     |
| bulkLoad + all lookups     | 983.5 µs     | 880.0 µs      | **11% faster** |

The cached lookup hot path (used on every neuron during forward activation and
backpropagation) shows 41-52% improvement, well above the 10% threshold.

## Test Plan

- All 4334 existing tests pass (`./quality.sh`)
- Existing `test/creature/CreatureTopology.ts` tests verify correct behaviour of
  inward/outward connections, self-connections, synapse lookups, and cache
  operations
- Benchmark: `deno bench --allow-read bench/TopologyCacheArrays.ts`
