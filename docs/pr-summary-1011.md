## Summary

This PR implements caching for weight/bias statistics in the score calculation function, addressing GitHub issue #1011.

### Problem

The `calculate()` function in `src/architecture/Score.ts` was performing full passes over all synapses and neurons on every fitness evaluation to compute max/avg weight/bias values. For large creatures (e.g., 619 neurons + 17,935 synapses = ~18,554 iterations), this was being repeated 50+ times per generation despite the structure not changing between evaluations.

### Solution

Extended the existing `CachedScoreComponents` interface to include:
- `maxWeightBias`: Maximum absolute value among all weights and biases
- `avgWeightBias`: Average absolute value among all weights and biases

These values are now computed once and cached alongside the existing `hiddenNeuronCount` and `squashComplexityPenalty`. The cache is invalidated when structure changes occur (via `invalidateScoreCache()`).

### Changes

1. **`src/Creature.ts`**: Extended `CachedScoreComponents` interface with `maxWeightBias` and `avgWeightBias` properties
2. **`src/architecture/Score.ts`**:
   - Removed separate `calculateMaxOutOfBounds()` function
   - Integrated weight/bias statistics calculation into `computeAndCacheScoreComponents()`
   - `calculate()` now uses cached values instead of recomputing on every call
3. **`test/score/ScoreCacheWeightBias.ts`**: New test file with 12 tests verifying caching behaviour
4. **`test/score/Penalty.ts`**: Updated test to invalidate cache after direct weight modification
5. **`bench/ScoreCalculationCache.ts`**: New benchmark for measuring performance improvement

## Evidence

### Benchmark Results

```
============================================================
Score Calculation Cache Benchmark (Issue #1011)
============================================================

Creature stats:
  Neurons: 230
  Synapses: 11375
  Hidden neurons: 175

Benchmark 1: Uncached (cache cleared before each call)
  Iterations: 1000
  Average: 437.63µs
  Min: 396.04µs
  Max: 1.647ms

Benchmark 2: Cached (cache reused across calls)
  Iterations: 1000
  Average: 0.25µs
  Min: 0.17µs
  Max: 5.29µs

============================================================
Results Summary
============================================================
Speedup: 1734.57x
Performance improvement: 99.9%

Benchmark 3: Realistic fitness evaluation (50 creatures, same structure)
  Population size: 50
  Generations: 20
  Average time per generation: 1.276ms
  Average time per creature: 25.53µs
```

**Key metrics:**
- **Speedup**: 1734x faster when cache is reused
- **Performance improvement**: 99.9%
- **Realistic scenario**: Evaluating 50 creatures takes ~1.3ms per generation with caching

### Why the improvement is so significant

Without caching, every call to `calculate()` iterates over:
- All 11,375 synapses to compute weight statistics
- All 230 neurons to compute bias statistics and complexity penalty

With caching, these values are computed once and reused for subsequent calls within the same generation (since creature structure doesn't change during fitness evaluation).

## Test Plan

- Added 12 new tests in `test/score/ScoreCacheWeightBias.ts`:
  - `cached weight/bias stats should be initialised after first score calculation`
  - `cached weight/bias stats should be reused on subsequent calculations`
  - `cache should be invalidated when synapse weight changes`
  - `cache should be invalidated when neuron bias changes`
  - `cache should be invalidated when synapse is added`
  - `cache should be invalidated when synapse is removed`
  - `cached values should be correct`
  - `multiple score calculations with different errors should reuse cache`
  - `performance - caching should avoid redundant iterations`
  - `clearCache should clear weight/bias stats`
  - `dispose should clear weight/bias stats`
  - `shallowClone should copy cached weight/bias stats`

- All 1305 existing tests pass
- `./quality.sh` passes cleanly

Fixes #1011
