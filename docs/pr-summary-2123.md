## Summary

Optimise topology grouping in `Fitness.ts` by eliminating an unnecessary array
copy and pre-computing topology hashes. Closes #2123.

### Changes

1. **Grouping disabled path**: Removed the unconditional `[...uniqueQueue]`
   spread that copied the entire array. `uniqueQueue` is now used directly since
   `.sort()` operates in-place and no copy is needed.

2. **Grouping enabled path**: Pre-compute topology hashes into a
   `Map<Creature, string>` before sorting, so the sort comparator does O(1)
   lookups instead of computing hashes O(n log n) times inside the comparator.

## Evidence

### Benchmark Results

**Grouping disabled (array copy elimination):**

| Population | Before ([...array]) | After (direct) | Speedup  |
| ---------- | ------------------- | -------------- | -------- |
| 100        | 21.7 ns             | 3.7 ns         | **5.9x** |
| 500        | 78.2 ns             | 3.8 ns         | **20.8x** |
| 1000       | 177.6 ns            | 4.2 ns         | **42.2x** |

**Grouping enabled (hash pre-computation):**

| Population | Before (inline hash) | After (pre-computed) | Speedup  |
| ---------- | -------------------- | -------------------- | -------- |
| 100        | 192.7 µs             | 60.3 µs              | **3.2x** |
| 500        | 1.4 ms               | 414.3 µs             | **3.4x** |
| 1000       | 3.3 ms               | 925.7 µs             | **3.5x** |

## Test Plan

- Added `test/architecture/FitnessTopologyGrouping.ts` with 3 tests:
  - Verifies creatures are grouped contiguously by topology hash when grouping
    is enabled
  - Verifies all creatures are evaluated when grouping is disabled
  - Verifies score correctness is preserved with topology grouping
- Added `bench/FitnessTopologyGrouping.ts` benchmark
- All 5184 existing tests pass via `./quality.sh`
