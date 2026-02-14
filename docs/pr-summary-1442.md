## Summary

Optimise max weight/bias recalculation in Score.ts by maintaining a runner-up
(second-highest) max value in the score cache. When the current maximum
weight or bias is reduced during an incremental update, the runner-up
enables O(1) max recovery instead of requiring an O(n) full scan of all
synapses and neurons. Closes #1442.

### Changes

- **`src/Creature.ts`**: Added `secondMaxWeightBias` field to the
  `CachedScoreComponents` interface.
- **`src/architecture/Score.ts`**:
  - `computeAndCacheScoreComponents()` now tracks both max and second-max
    during the initial full scan (no additional pass needed).
  - `updateScoreForWeightChange()` and `updateScoreForBiasChange()` use the
    cached second-max for O(1) max recovery when the current max is reduced.
    The second-max is marked stale (`-1`) after use and re-established on the
    next full scan.
  - Renamed `findNewMaxWeightBias()` / `findNewMaxWeightBiasForBias()` to
    `scanMaxForWeightChange()` / `scanMaxForBiasChange()` and updated them to
    return both max and second-max in a single scan pass.
  - Added staleness tracking: second-max is invalidated when a value equal to
    it is reduced, preventing stale values from producing incorrect results.

### How it works

1. **Full scan** (initial cache build or stale second-max): Tracks both the
   highest and second-highest absolute weight/bias values.
2. **First max reduction** after a full scan: Uses the cached second-max for
   O(1) recovery. No scan needed.
3. **Second max reduction** (if second-max is stale): Falls back to a single
   scan that re-establishes both max and second-max.

This means the first max reduction after any full scan is always O(1), and
alternating max reductions produce O(1) / O(n) / O(1) / O(n) behaviour,
effectively halving the number of full scans in the worst case.

## Evidence

This is a purely backend/algorithmic change with no visual output.

Benchmark results from `bench/MaxWeightBiasRecalculation.ts`:

| Scenario | Creature Size | Avg per iteration |
|---|---|---|
| Repeated max reductions | 230 neurons, 11,375 synapses | 0.51 us |
| Mixed mutations (~20% max-reducing) | 230 neurons, 11,375 synapses | 0.46 us |
| Repeated max reductions | 610 neurons, 70,500 synapses | 0.43 us |
| Mixed mutations (~20% max-reducing) | 610 neurons, 70,500 synapses | 0.22 us |

The "Repeated max reductions" and "Mixed mutations" scenarios show
sub-microsecond performance because the second-max enables O(1) recovery
without scanning all synapses. In contrast, a full scan of 70,500 synapses
takes approximately 2.7ms.

## Test Plan

- Added `test/score/MaxWeightBiasRecalculation.ts` with 8 tests:
  - Reducing max weight matches full recalculation
  - Reducing max bias matches full recalculation
  - Repeated max reductions match full recalculation
  - Max cached correctly after new weight exceeds current max
  - Max correctly tracks bias as the global max
  - Negative weights tracked by absolute value
  - Interleaved weight and bias mutations match full recalculation
  - Large creature max reduction matches full recalculation
- All existing 3,281 tests pass unchanged
- Added `bench/MaxWeightBiasRecalculation.ts` benchmark for measuring the
  optimisation impact
