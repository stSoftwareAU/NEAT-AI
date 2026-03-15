## Summary

Second-pass audit of compact and optimisation test files across
`test/Compact/`, `test/optimize/`, `test/optimization/`, `test/FeedForward/`,
and `test/reconstruct/`. Removes remaining duplicates, strengthens weak
assertions, removes debug logging, and standardises assertion patterns.
Closes #1772.

## Changes

### Duplicate tests removed (3 tests across 2 files)

**test/Compact/CompactUtils.ts** — 2 `cleanupOrphanedNeurons` tests that
duplicated more comprehensive tests already in `CleanupOrphanedNeurons.ts`:
- "removes neurons with no outward connections"
- "converts hidden with no inward to constant"

**test/optimization/LearningRateVerification.ts** — Entire file deleted (2
tests). Both tests duplicated `AdaptiveLearningRate.ts`:
- "should actually decay learning rate over iterations" — duplicate of "decay
  strategy produces monotonically decreasing rates"
- "should use fixed learning rate when strategy is fixed" — duplicate of "fixed
  strategy returns constant rate across iterations"

### Near-duplicate test removed (1 test)

**test/optimization/AdaptiveVsDecay.ts** — "adaptive responds to error
feedback" removed as near-duplicate of ErrorFeedbackLearningRate.ts "adaptive
rate increases when error stagnates" (same config, same stagnation scenario).

### Weak assertions strengthened (4 files)

**test/Compact/CompactCreatureCloneOptimisation.ts** — 2 tests ("preserves tags
on synapses", "preserves synapse types") wrapped all assertions in
`if (compacted)`, silently passing with zero assertions when compaction didn't
occur. Restructured to use IDENTITY chains guaranteed to compact, with
unconditional assertions.

**test/optimization/MiniBatch.ts** — Replaced meaningless `error >= 0` and weak
`error < 10` with baseline comparison: compute initial error before training,
assert trained error is less.

**test/optimization/SparseSelection.ts** — Both tests used weak `error < 1.0`
with no baseline. Replaced with initial error computation and assertion that
training reduces error.

**test/optimize/activate/HYPOTv2.ts** — Replaced manual `if/fail` +
`console.info` pattern with standard `assertAlmostEquals` (consistent with
HYPOT.ts and other activate tests).

### Debug logging removed (2 files)

- **AdaptiveVsDecay.ts** — removed 2 `console.log` calls
- **LearningRateRandomization.ts** — removed 4 `console.log` calls

### Test names improved (2 files)

- **LearningRateRandomization.ts** — "should have reasonable distribution"
  renamed to "all strategies appear in random selection"
- **AdaptiveVsDecay.ts** — shortened to "adaptive produces different rates than
  decay"

### Directories confirmed clean (no changes needed)

- `test/FeedForward/` (8 files, 21 tests) — all high-quality behavioural tests
- `test/reconstruct/` (3 files, 23 tests) — all verify outcomes with strong
  assertions

## Evidence

All 4534 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Verified all remaining tests still pass after removing duplicates
- Verified strengthened assertions correctly test the intended behaviour
- Verified no test coverage was lost (removed tests were duplicates of retained
  tests)
- Ran full quality gate (`./quality.sh --skip-discovery --skip-wasm`): 4534
  passed, 0 failed
