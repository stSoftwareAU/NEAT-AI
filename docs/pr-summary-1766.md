## Summary

Final audit of propagation module tests: removed last cross-file duplicate test.
Addresses #1766.

### Changes

**Cross-file duplicate removed:**

- Deleted `test/propagate/minimum/Minimum.ts` — duplicates
  `test/propagate/Minimum.ts`. Both tested MINIMUM activation convergence after
  bias and weight perturbation. The top-level `Minimum.ts` tests a more complex
  architecture (5 inputs, 2 outputs, mixed squash functions) and is the cleaner
  implementation. The subdirectory version also had code smells: cached test data
  on disk (`.td.json`), `console.log` output, file I/O for debugging, and a
  lenient regression tolerance (0.02).

## Audit Summary

All 82 test files across `test/propagate/` (root and subdirectories) have been
reviewed against the audit criteria:

- **Uniqueness**: No duplicate or near-duplicate tests remain (within scope or
  cross-file)
- **Behavioural testing**: All tests verify outcomes, not implementation details
- **Meaningful tests**: All tests have real assertions on real code
- **Organisation**: Test names clearly describe the behaviour being verified

This is the eleventh and final PR in the audit series:

- PR #1787: Consolidated and improved propagation module tests
- PR #1788: Fixed vague test names, trivial tests, and missing assertions
- PR #1789: Remaining vague test names and missing assertions
- PR #1790: Final pass on test names and misleading filename
- PR #1791: Removed duplicate tests and standardised batch test names
- PR #1792: Removed duplicate WASM batch test files
- PR #1793: Fixed broken Identity.ts test with missing assertions
- PR #1794: Fixed assertion quality issues
- PR #1795: Removed duplicate tests, dead code, and missing assertions
- PR #1796: Removed final commented-out dead code
- This PR: Removed cross-file duplicate minimum/Minimum.ts

## Evidence

All 4775 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Verified the removed test is already covered by `test/propagate/Minimum.ts`
  which tests the same MINIMUM activation convergence behaviour
- Full test suite passes (4775 tests, 0 failures)
