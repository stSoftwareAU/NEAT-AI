# PR Summary: Performance: Avoid disconnect() linear search using binary search

## Summary

Optimised the `disconnect()` method in `src/Creature.ts` to use binary search (O(log n)) instead of linear search (O(n)) for finding synapses to remove. This provides significant performance improvements for large creatures with many synapses.

### Changes Made

1. **Added `binarySearchSynapse()` private method** - Performs binary search on the sorted synapses array using composite key `(from, to)`.

2. **Updated `disconnect()` method** - Now uses `binarySearchSynapse()` instead of linear iteration.

### Technical Details

The synapses array is already maintained in sorted order by `(from, to)`, which is leveraged by existing methods like `outwardConnections()`. The new binary search takes advantage of this ordering:

```typescript
private binarySearchSynapse(from: number, to: number): number {
  const synapses = this.synapses;
  let low = 0;
  let high = synapses.length - 1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const syn = synapses[mid];

    if (syn.from < from) {
      low = mid + 1;
    } else if (syn.from > from) {
      high = mid - 1;
    } else {
      // syn.from === from, now compare `to`
      if (syn.to < to) {
        low = mid + 1;
      } else if (syn.to > to) {
        high = mid - 1;
      } else {
        return mid; // Found exact match
      }
    }
  }

  return -1; // Not found
}
```

## Evidence

### Benchmark Results (Apple M4 Pro)

Comparison of linear search vs binary search for 100 lookups at different array positions:

| Synapses | Position | Linear Search | Binary Search | Speedup |
|----------|----------|---------------|---------------|---------|
| 1,000 | middle | 37.1 µs | 190.1 ns | **195x faster** |
| 1,000 | last | 56.2 µs | 998.0 ns | **56x faster** |
| 5,000 | middle | 273.3 µs | 210.2 ns | **1,300x faster** |
| 5,000 | last | 444.7 µs | 1.3 µs | **342x faster** |
| 10,000 | middle | 446.8 µs | 1.3 µs | **344x faster** |
| 10,000 | last | 973.2 µs | 1.4 µs | **695x faster** |
| 20,000 | middle | 910.6 µs | 1.5 µs | **607x faster** |
| 20,000 | last | 1.7 ms | 1.5 µs | **1,133x faster** |

**Not-found case (10,000 synapses):**
- Linear: 664.3 µs
- Binary: 1.2 µs
- **531x faster**

Note: Linear search is faster for the **first** element (0 index) since it finds it immediately, but this is the minority case during evolution where synapses are typically removed from various positions.

### Complexity Analysis

- **Before (Linear):** O(n) - average n/2 comparisons
- **After (Binary):** O(log n) - approximately log₂(n) comparisons

For a creature with 17,935 synapses (as mentioned in the issue):
- Linear search: ~8,968 comparisons on average
- Binary search: ~14 comparisons
- **~640x fewer comparisons**

## Test Plan

### New Tests Added
- `test/disconnect/DisconnectBinarySearch.ts` - 11 test cases covering:
  - Basic disconnect operations (first, middle, last synapse)
  - Non-existent synapse handling
  - Sorted order preservation
  - Cache invalidation
  - Multiple synapses with same `from` index
  - Single synapse creature edge case
  - Sequential disconnects
  - Empty synapses array edge case

### Existing Test Coverage
All existing tests that use `disconnect()` continue to pass:
- `test/score/ScoreCache.ts`
- `test/score/ScoreCacheWeightBias.ts`
- `test/mutate/AvailableConnectionsCache.ts`
- `test/FeedForward/MakeRandomConnectionForwardOnly.ts`
- `test/mutate/SubBackCon.ts`
- `test/mutate/MutatorRepairsForwardOnlyFourXCorruption.ts`

### Benchmarks Added
- `bench/DisconnectBinarySearch.ts` - Performance benchmark for disconnect operations
- `bench/DisconnectLinearVsBinary.ts` - Direct comparison of linear vs binary search

## Related Issues

- Closes #1101
- Part of #1090 (Find potential performance improvements in the evolution process)
