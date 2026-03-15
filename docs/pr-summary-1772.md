## Summary

Fourth-pass audit of compact and optimisation test files across `test/Compact/`,
`test/optimize/`, `test/optimization/`, `test/FeedForward/`, and
`test/reconstruct/`. Strengthens weak assertions with exact computed values,
removes a redundant duplicate test, fixes misleading test names, and adds missing
`warm_restart` strategy coverage. Closes #1772.

## Changes

### Weak assertions strengthened (3 files)

**test/optimization/AdaptiveVsDecay.ts** — Replaced vague "differences found > 0"
counter with exact computed-value assertions:
- Asserts both strategies equal 0.1 at iteration 0
- Asserts decay rate = `0.1 * 0.95` and adaptive rate = `0.1 * sqrt(0.95)` at iteration 1
- Asserts exact values at iteration 5 using `Math.pow`
- Renamed test to "adaptive decays slower than pure decay at the same iteration"

**test/optimization/ErrorFeedbackLearningRate.ts** — Replaced generic bound
checks with exact formula-derived assertions:
- Test 4: "still works" → "falls back to decay-based rate"; replaced `isFinite` +
  `> 0` with `assertAlmostEquals(rate, 0.1 * Math.pow(Math.sqrt(0.95), 5))`
- Test 5: "stays within reasonable bounds" → "stagnation boosts, worsening
  reduces"; replaced `<= 2x initial` with exact stagnation/worsening rate formulas

**test/optimization/LearningRateRandomization.ts** — Strengthened assertions:
- Tests 2-3: replaced `assert(x === "value", ...)` with `assertEquals`
- Test 4: added missing `warm_restart` strategy check (was only checking 3 of 4
  strategies); increased sample size from 100 to 200 for reliability
- Renamed test 4 to "all four strategies appear in random selection"

### Duplicate test removed (1 file)

**test/Compact/CompactCreatureSimplifyLargeWeightsSupportedSquashes.ts** — Removed
redundant ABSOLUTE test (lines 232-248) that duplicated the dedicated test in
`CompactCreatureSimplifyLargeWeights.ts`. Removed unused ABSOLUTE import.

### Misleading test names fixed (1 file)

**test/optimization/SparseSelection.ts** — Renamed tests to describe actual
network topology differences:
- "output-distance converges" → "converges with multi-path hidden layer"
- "random fallback converges" → "converges with single-path hidden layer"

## Evidence

All 4520 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Verified all strengthened assertions produce correct expected values by
  matching them to the `calculateLearningRate` implementation formulas
- Verified ABSOLUTE test coverage is retained in
  `CompactCreatureSimplifyLargeWeights.ts`
- Verified warm_restart strategy appears in random selection with 200 samples
- Ran full quality gate: format, lint, type-check, and all tests pass
