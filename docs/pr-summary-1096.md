## Summary

Optimised the `ModWeight` mutation to use indexed synapse lookups (`outwardConnections`/`inwardConnections`) instead of scanning all synapses when a focus list is provided. This eliminates expensive `inFocus()` calls that could recursively traverse connections.

### Problem

The original implementation filtered all synapses by calling `inFocus()` twice per synapse (once for `from`, once for `to`). For large creatures with 17,935 synapses and a focus list of 10 neurons, this meant:
- 17,935 synapses scanned per mutation
- Up to 35,870 `inFocus()` calls per mutation
- `inFocus()` can recursively traverse inward connections

### Solution

When a focus list is provided, use indexed lookups to directly collect only relevant synapses:

```typescript
if (!focusList || focusList.length === 0) {
  relevantConnections = this.creature.synapses;
} else {
  const seen = new Set<Synapse>();
  for (const focusIndex of focusList) {
    for (const syn of this.creature.outwardConnections(focusIndex)) {
      seen.add(syn);
    }
    for (const syn of this.creature.inwardConnections(focusIndex)) {
      seen.add(syn);
    }
  }
  relevantConnections = Array.from(seen);
}
```

## Evidence

### Benchmark Results

**Test Configuration:**
- 1000 ModWeight mutations
- Creature with ~6,100 synapses (360 neurons)
- Focus list of 10 neurons

**Before Optimisation:**
```
With focus list (10 items): 416.68ms
  Per mutation: 0.4167ms
Without focus list: 126.61ms
  Per mutation: 0.1266ms
Ratio (focus/no-focus): 3.29x slower
```

**After Optimisation:**
```
With focus list (10 items): 9.97ms
  Per mutation: 0.0100ms
Without focus list: 0.20ms
  Per mutation: 0.0002ms
```

### Performance Improvement

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Focused mutations (1000 iterations) | 416.68ms | 9.97ms | **41.8x faster** |
| Per-mutation time | 0.4167ms | 0.0100ms | **41.7x faster** |

The optimisation delivers **97.6% reduction** in execution time for focused mutations on large creatures.

### Scaling Behaviour

```
Synapses: 2,591 | Focus: 8.7ms (was scanning all)
Synapses: 5,602 | Focus: 4.3ms (was scanning all)
Synapses: 6,100 | Focus: 8.2ms (was scanning all)
```

Time now scales with the number of synapses connected to focused neurons, not the total synapse count.

## Test Plan

Added comprehensive tests in `test/mutate/ModWeightFocusBenchmark.ts`:

1. **Correctness tests:**
   - `ModWeight - mutate correctly modifies weight with focus list` - verifies mutations only affect synapses connected to focus list
   - `ModWeight - mutate works without focus list` - verifies no-focus behaviour unchanged
   - `ModWeight - returns false when no synapses exist` - edge case handling
   - `ModWeight - focus list with no connected synapses returns false` - edge case handling
   - `ModWeight - empty focus list treated as no focus` - empty array treated same as undefined
   - `ModWeight - collects synapses from both inward and outward connections` - verifies both directions collected

2. **Performance benchmarks:**
   - `ModWeight - benchmark: 1000 mutations with focus list on large creature` - main benchmark with 6,100+ synapses
   - `ModWeight - benchmark: comparison with varying synapse counts` - scaling behaviour across different creature sizes

All 1418 tests pass including the new benchmark tests.

## Files Changed

- `src/mutate/ModWeight.ts` - optimised `mutate()` method with indexed lookups
- `test/mutate/ModWeightFocusBenchmark.ts` - new benchmark and correctness tests (8 tests)

Closes #1096
