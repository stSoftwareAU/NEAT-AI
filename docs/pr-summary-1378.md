## Summary

Pre-compute and cache SquashType enum values on each Neuron to avoid repeated
`getSquashType()` string-to-enum lookups during backpropagation (#1378).

During `Neuron.propagate()`, `getSquashType()` was called once per neuron and
once per inbound synapse on every training sample. Each call performed a Map
lookup and potentially an `Activations.find()` fallback. The new
`cachedSquashType()` method on Neuron computes the value lazily and caches it,
following the same pattern as the existing `complexityPenaltyCache`. The cache
is invalidated in `setSquash()` and `fix()`.

## Evidence

### Benchmark Results

```
benchmark                                     | time/iter (avg)
--------------------------------------------- | ---------------
group squash-type-lookup-100N-800S
  getSquashType() per call (100N/800S)        |         21.3 µs
  Pre-computed cache (100N/800S)              |        660.9 ns  ← 32x faster

group squash-type-lookup-500N-4000S
  getSquashType() per call (500N/4000S)       |        152.0 µs
  Pre-computed cache (500N/4000S)             |          2.8 µs  ← 55x faster

group squash-type-lookup-2000N-16000S
  getSquashType() per call (2000N/16000S)     |        651.9 µs
  Pre-computed cache (2000N/16000S)           |         12.7 µs  ← 51x faster

group single-lookup
  Single getSquashType() call                 |         19.1 ns
  Single Uint8Array read                      |          4.1 ns  ← 4.7x faster
```

The pre-computed cache eliminates 32–55x overhead in the squash type resolution
path. For a network with 2000 neurons and 16000 synapses, this saves ~639 µs per
backward pass per training sample.

### What was changed

- **`src/architecture/Neuron.ts`**: Added `squashTypeCache` field and
  `cachedSquashType()` method. Updated `propagate()` to use cached values. Cache
  invalidated in `setSquash()` and `fix()`.

This is a backend/CLI change with no visual output.

## Test Plan

- Added `test/wasm/PreComputedSquashTypes.ts` with 6 tests:
  - `cachedSquashType returns correct type for each neuron`
  - `cachedSquashType matches getSquashType for all squash names` (20 squash
    types)
  - `cachedSquashType is invalidated by setSquash()`
  - `cachedSquashType is stable across multiple calls`
  - `cachedSquashType for input neurons returns Identity`
  - `propagate still produces correct results with cached squash types`
- All 2240 existing tests pass unchanged
- Added `bench/PreComputedSquashTypes.ts` benchmark
