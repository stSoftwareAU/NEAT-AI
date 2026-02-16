## Summary

Replaced the O(n*d) splice-based duplicate removal loop in `DeDuplicator.perform()` with an O(n) in-place filter approach using a Set of indices. Closes #1477.

The old approach called `creatures.splice(indx, 1)` for each duplicate in reverse order, shifting all subsequent array elements on every call. The new approach builds a Set of indices to remove, then performs a single forward pass with read/write pointers, truncating the array at the end.

## Evidence

### Benchmark Results

Benchmark script: `bench/DeDuplicatorSpliceOptimisation.ts`

| Population Size | Removals | Splice (old) | Filter (new) | Speedup |
|----------------|----------|-------------|-------------|---------|
| 100 | 10 | 229 ns | 430 ns | 0.53x (splice faster at small scale) |
| 1,000 | 258 | 12.3 us | 7.3 us | **1.69x faster** |
| 10,000 | 3,902 | 972.5 us | 116.1 us | **8.38x faster** |
| 50,000 | 19,683 | 41.1 ms | 1.1 ms | **36.40x faster** |

The filter approach shows dramatic improvement at scale. At small sizes (100 elements), splice is slightly faster due to lower overhead, but the crossover happens quickly and the benefit grows superlinearly with population size.

## Test Plan

- Existing test `test/DeDuplicate.ts` continues to pass
- Added `test/DeDuplicateBulkRemoval.ts` with three new tests:
  - `DeDuplicator bulk removal preserves unique creatures` - verifies unique creatures survive deduplication
  - `DeDuplicator bulk removal handles all-duplicates correctly` - verifies population reduction with all-duplicate input
  - `DeDuplicator preserves array order for non-removed elements` - verifies original creatures are preserved
- All 3823 tests pass
