## Summary

Final audit of compact/optimisation tests: strengthen weak assertions,
consolidate near-duplicate tests, replace implementation-detail tests with
behavioural tests, and add explicit tolerances to floating-point comparisons.
Closes #1772.

All test files in `test/Compact/`, `test/optimize/`, `test/optimization/`,
`test/FeedForward/`, and `test/reconstruct/` have been reviewed. The audit
confirmed:

- **No duplicate tests remain** — SparseSelection near-duplicates consolidated
- **All tests verify behaviour** — ErrorFeedback test rewritten from
  implementation-constant testing to behavioural assertions
- **All tests are meaningful** — trivial "no exception thrown" tests now assert
  correct post-condition state
- **Test names clearly describe behaviour** — improved where misleading
- **Assertions are strong** — added explicit tolerances, error codes, and
  post-condition checks

### Changes

- **test/reconstruct/ValidateDNATypedErrors.ts**: Added `error.code` assertions
  to tests 2–4 (previously only checked exception type, not error code)
- **test/Compact/CompactUtils.ts**: Strengthened "handles missing memetic
  gracefully" tests with positive assertions on post-condition state
- **test/optimize/simplify/IDENTITY.ts**: Replaced trivial `assert(!result)`
  with `assertEquals(result, undefined)` and added original-unchanged
  verification
- **test/optimize/simplify/COMPLEMENT.ts**: Improved test name to reflect both
  transformation and behaviour preservation
- **test/optimize/activate/HYPOT.ts, HYPOTv2.ts, Maximum.ts, Minimum.ts**: Added
  explicit tolerance values to all `assertAlmostEquals` calls and removed
  redundant manual `assert(Math.abs(...))` checks
- **test/optimization/SparseSelection.ts**: Consolidated two near-duplicate
  tests (multi-path and single-path) into a single parameterised test
- **test/optimization/MiniBatch.ts**: Strengthened partial-batch test with
  per-sample output verification
- **test/optimization/ErrorFeedbackLearningRate.ts**: Rewrote test 5 from
  implementation-constant verification (hardcoded multipliers 1.3, 0.5) to
  behavioural assertions (stagnation boosts above base, worsening reduces below
  base)

## Evidence

- `./quality.sh` passes: 4508 tests passed, 0 failed
- All acceptance criteria met

## Test Plan

- No new tests added; 11 existing test files improved
- Verified all 4508 tests pass after changes
