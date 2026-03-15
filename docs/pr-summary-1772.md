## Summary

Final audit pass on compact/optimisation tests: fix remaining assertion style
inconsistency and correct misleading test names. Closes #1772.

All test files in `test/Compact/`, `test/optimize/`, `test/optimization/`,
`test/FeedForward/`, and `test/reconstruct/` have been reviewed across 9 PRs.
The audit confirmed:

- **No duplicate tests remain** — prior passes removed all duplicates
- **All tests verify behaviour** — no "how" tests (no source grepping, no
  implementation detail assertions)
- **All tests are meaningful** — no trivial/placeholder assertions
- **Test names clearly describe behaviour** — misleading names corrected in this
  pass

### Changes

- **test/optimize/activate/RELU.ts**: Replaced `fail()` with
  `assertAlmostEquals()` for consistency with all other activate tests
- **test/optimize/activate/HYPOTv2.ts**: Corrected test name from "per-input
  bias" to "uniform bias offset" — the bias is applied uniformly to all inputs,
  not per-input
- **test/optimization/MiniBatch.ts**: Corrected test name from "should
  accumulate gradients across batch" to "different batch sizes converge to
  similar error" — the test compares batch-size-1 vs batch-size-4 convergence,
  not gradient accumulation

## Evidence

- `./quality.sh` passes: 4509 tests passed, 0 failed
- All acceptance criteria met across 9 PRs (#1821–#1828 + this PR)

## Test Plan

- No new tests added; existing tests improved with clearer names and consistent
  assertion style
- Verified all 4509 tests pass after changes
