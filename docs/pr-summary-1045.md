# PR Summary: Performance: Implement incremental score update for weight-only mutations

## Summary

This PR implements incremental score updates for weight-only and bias-only
mutations (Issue #1045). Instead of invalidating the entire score cache and
recalculating all weight/bias statistics when a MOD_WEIGHT or MOD_BIAS mutation
occurs, we now update only the affected components incrementally.

### Changes Made

1. **Extended `CachedScoreComponents` interface** (`src/Creature.ts`):
   - Added `totalWeightBias` and `countWeightBias` fields to enable incremental
     updates

2. **Added incremental update functions** (`src/architecture/Score.ts`):
   - `updateScoreForWeightChange()`: Incrementally updates score after a weight
     change
   - `updateScoreForBiasChange()`: Incrementally updates score after a bias
     change
   - Helper functions `findNewMaxWeightBias()` and
     `findNewMaxWeightBiasForBias()` for rare cases where the changed value was
     the previous maximum

3. **Tests** (`test/score/IncrementalScoreUpdate.ts`):
   - 11 comprehensive tests verifying correctness and performance of incremental
     updates

4. **Benchmark** (`bench/IncrementalScoreUpdate.ts`):
   - Detailed benchmark comparing incremental vs full recalculation performance

## Evidence

### Benchmark Results

The benchmark demonstrates significant performance improvements:

```
======================================================================
Incremental Score Update Benchmark (Issue #1045)
======================================================================

Creature sizes:
  Large: 230 neurons, 11375 synapses
  Very Large: 610 neurons, 70500 synapses

--- Large Creature Benchmarks ---

Weight mutations:
  Creature: 230 neurons, 11375 synapses
  Iterations: 1000
  Incremental: 522.46µs
  Full recalc: 495.005ms
  Speedup: 947.45x
  Improvement: 99.9%

Bias mutations:
  Creature: 230 neurons, 11375 synapses
  Iterations: 1000
  Incremental: 353.79µs
  Full recalc: 487.219ms
  Speedup: 1377.13x
  Improvement: 99.9%

--- Very Large Creature Benchmarks ---

Weight mutations:
  Creature: 610 neurons, 70500 synapses
  Iterations: 1000
  Incremental: 201.96µs
  Full recalc: 3.065s
  Speedup: 15177.93x
  Improvement: 100.0%

Bias mutations:
  Creature: 610 neurons, 70500 synapses
  Iterations: 1000
  Incremental: 154.88µs
  Full recalc: 3.069s
  Speedup: 19816.41x
  Improvement: 100.0%

======================================================================
Summary
======================================================================

Average speedup across all benchmarks: 9329.73x
Average improvement: 100.0%

Target (30-50% faster): ✅ MET
```

The implementation far exceeds the issue's target of 30-50% faster scoring:

- **Large creatures (230 neurons, 11K synapses)**: ~1000x faster
- **Very large creatures (610 neurons, 70K synapses)**: ~15,000-20,000x faster

### Why the Improvement is So Large

The incremental update avoids:

1. Iterating over all synapses (O(n) where n = synapse count)
2. Iterating over all neurons (O(m) where m = neuron count)
3. Recalculating complexity penalty for each neuron

Instead, it performs O(1) arithmetic operations to update:

- Total weight/bias sum (subtract old, add new)
- Average (recalculate from new total)
- Maximum (only full scan if the changed value was the previous max)

## Test Plan

### New Tests Added

- `test/score/IncrementalScoreUpdate.ts` - 11 tests covering:
  1. Weight change produces same score as full recalculation
  2. Bias change produces same score as full recalculation
  3. Cache is updated (not invalidated) after incremental weight update
  4. Cache is updated (not invalidated) after incremental bias update
  5. Structure components remain unchanged after weight update
  6. Structure components remain unchanged after bias update
  7. Multiple weight changes accumulate correctly
  8. Negative weight changes handled correctly
  9. Zero weight changes handled correctly
  10. Performance: incremental is faster than full recalc for large creatures
  11. Works correctly when cache is initially empty

### Existing Tests Verified

All 1370 existing tests continue to pass, including:

- `test/score/ScoreCache.ts` - 11 tests
- `test/score/ScoreCacheWeightBias.ts` - 12 tests
- `test/score/NeuronComplexityPenaltyCache.ts` - 9 tests

## Usage

The new functions can be used when performing weight or bias mutations:

```typescript
import {
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "./src/architecture/Score.ts";

// For weight mutations
const oldWeight = synapse.weight;
synapse.weight = newWeight;
const score = updateScoreForWeightChange(
  creature,
  error,
  growthCost,
  oldWeight,
  newWeight,
);

// For bias mutations
const oldBias = neuron.bias;
neuron.bias = newBias;
const score = updateScoreForBiasChange(
  creature,
  error,
  growthCost,
  oldBias,
  newBias,
);
```

## Notes

- The incremental update functions are exported from `src/architecture/Score.ts`
  for use by mutation code
- The functions preserve the existing cache when possible, only updating the
  weight/bias-related fields
- Structure-dependent fields (hiddenNeuronCount, squashComplexityPenalty,
  synapse count) remain unchanged for weight-only/bias-only mutations
- If the cache is empty when an incremental update is requested, it builds the
  cache first

## Related Issue

Closes #1045 - Part of #1008 (Performance improvements in evolution process)
