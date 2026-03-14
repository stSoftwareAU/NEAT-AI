## Summary

Replace O(n²) `indexOf()`/`includes()` patterns with O(n) Map/Set-based lookups
in hot paths. Addresses #1763.

### Changes

1. **FineTunePopulation.weightedRandomSelect** — Replaced
   `creatures.indexOf(creature)` (called inside both `reduce()` and `for...of`)
   with direct index-based iteration. This eliminates the O(n²) linear scan
   entirely.

2. **CombinedFromSuccessful.buildCombination** — Replaced
   `appliedTypes.includes()` array check with `Set.add()`/`Set.has()` for O(1)
   type deduplication.

3. **CombinedFromSuccessful index mapping** — Pre-computed a `candidateIndexMap`
   (Map) so that `removalCandidates.map(c => successfulCandidates.indexOf(c))`
   becomes `removalCandidates.map(c => candidateIndexMap.get(c)!)`, reducing
   O(n·m) to O(n).

## Evidence

Benchmark results on Apple M4 Pro (Deno 2.7.4):

### weightedRandomSelect (critical path)

| Size | indexOf (old) | index-loop (new) | Speedup          |
| ---- | ------------- | ---------------- | ---------------- |
| 50   | 380 ns        | 56 ns            | **6.8x faster**  |
| 200  | 4.5 µs        | 152 ns           | **29.9x faster** |
| 1000 | 87.3 µs       | 656 ns           | **133x faster**  |

### Index mapping (build-once, use-twice)

| Size | 2x indexOf (old) | Map-once (new) | Speedup                                         |
| ---- | ---------------- | -------------- | ----------------------------------------------- |
| 50   | 352 ns           | 902 ns         | 2.6x slower (Map overhead dominates at small n) |
| 200  | 4.2 µs           | 3.6 µs         | **1.2x faster**                                 |
| 1000 | 83.3 µs          | 16.6 µs        | **5x faster**                                   |

### Type tracking (includes → Set)

The type tracking change is a code quality improvement — with only ~7 unique
change types, both approaches are sub-microsecond. Performance is equivalent at
typical sizes.

## Test Plan

- Added `test/blackbox/WeightedRandomSelect.ts` — 3 tests verifying weighted
  selection correctness (always returns array member, single-element case, both
  elements selectable)
- Added `test/discovery/CombinedFromSuccessfulIndexMap.ts` — 2 tests verifying
  mixed candidate combinations and unique type tracking after refactoring
- All 4910 existing tests pass
- Added `bench/IndexOfToMapLookup.ts` — comprehensive benchmarks for all three
  patterns
