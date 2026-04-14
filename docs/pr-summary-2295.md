## Summary

Fixed `AssertionError` in `fineTuneImprovement` when a creature has a score of
exactly `0`. The assertion `assert(fittest.score)` treated `0` as falsy, causing
a crash for creatures with perfect (zero-error) scores. Replaced with a
`Number.isFinite()` guard that correctly accepts `0` while still rejecting
`undefined`, `NaN`, and `Infinity`. Closes #2295.

## Evidence

This is a backend bug fix with no visual output. The fix is verified by 4 new
unit tests covering:

- Score of `0` (the crash scenario from the issue)
- Score of `NaN` (should return empty, not crash)
- Both scores equal to `0` (should return empty since scores match)
- Score of `-0` (edge case, should work like `0`)

All 5786 existing tests continue to pass.

## Test Plan

- Added `test/blackbox/FineTuneZeroScore.ts` with 4 test cases:
  - `fineTuneImprovement accepts zero score` — reproduces the exact crash from
    issue #2295
  - `fineTuneImprovement returns empty for non-finite score` — validates NaN
    handling
  - `fineTuneImprovement returns empty when both scores are zero` — validates
    equal-score guard
  - `fineTuneImprovement handles negative zero score` — validates -0 edge case
- Verified all existing `FineTune`, `BackTrack`, `Retry`, `MemeticPreserved`,
  and `MemeticAncestry` tests pass unchanged
