## Summary

Avoid unnecessary array copy in `Fitness.ts` topology grouping setup. Closes #2043.

Two optimisations applied to the fitness evaluation queue preparation in `Fitness.calculate()`:

1. **Removed unnecessary array copy when topology grouping is disabled**: Previously, `[...uniqueQueue]` was called unconditionally in both branches. Now `uniqueQueue` is used directly, eliminating an O(n) allocation.
2. **Pre-computed topology hashes before sorting**: When topology grouping is enabled, hashes are computed once in an O(n) pass into a `Map`, then the sort comparator does O(1) `Map.get()` lookups instead of calling `CreatureUtil.getTopologyHash()` on each comparison. The sort now operates in-place on `uniqueQueue` instead of a copy.

## Evidence

Benchmark results from `bench/FitnessTopologySetup.ts` (Apple M4 Pro, Deno 2.7.8):

### Topology grouping disabled (array copy elimination)

| Population | Baseline (copy) | Optimised (no copy) | Speedup |
|------------|-----------------|---------------------|---------|
| 100        | 21.8 ns         | 3.3 ns              | **6.7x** |
| 500        | 87.9 ns         | 3.1 ns              | **28.8x** |
| 1000       | 247.4 ns        | 4.6 ns              | **53.8x** |

### Topology grouping enabled (pre-computed hashes + in-place sort)

| Population | Baseline (hash in comparator) | Optimised (pre-computed) | Speedup |
|------------|-------------------------------|--------------------------|---------|
| 100        | 386.9 µs                      | 380.8 µs                 | 1.02x   |
| 500        | 2.0 ms                        | 2.0 ms                   | ~1.00x  |
| 1000       | 4.0 ms                        | 4.0 ms                   | ~1.00x  |

The grouping-enabled case shows negligible difference because `getTopologyHash()` already caches on `creature.topologyHash`. The main win is eliminating the array copy, which scales linearly with population size.

## Test Plan

- Added `test/architecture/FitnessTopologySetup.ts` with 3 tests:
  - Verifies topology grouping clusters same-topology creatures contiguously
  - Verifies all creatures are evaluated when grouping is disabled
  - Verifies scores are identical regardless of grouping setting
- All 29 existing Fitness-related tests pass unchanged
- Added `bench/FitnessTopologySetup.ts` benchmark
