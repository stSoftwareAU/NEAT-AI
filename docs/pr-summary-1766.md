## Summary

Final audit pass on propagation module tests: removed duplicate tests, added
missing assertions, cleaned up dead code and global state mutation. Addresses
#1766.

### Changes

**Duplicate tests removed:**

- Deleted `test/propagate/LimitBias.ts` (3 tests) — all scenarios already
  covered by `test/propagate/Bias.ts` limitBias section
- Deleted `test/propagate/LimitWeight.ts` (3 tests) — all scenarios already
  covered by `test/propagate/Weight.ts` limitWeight section (also fixed a
  copy-paste bug where `weight` was referenced instead of `weight2` in an
  assertion message)
- Removed 6 `limitBias`/`limitWeight` rejection tests from
  `test/propagate/FiniteValueProtection.ts` — duplicated by `Bias.ts`,
  `Weight.ts`, and `BiasTypedErrors.ts`

**Missing assertions fixed:**

- `test/propagate/TopologicalBackpropagation.ts` self-loop test: added
  assertions verifying all synapse weights and neuron biases remain finite after
  propagation through a self-loop (previously had no assertions)

**Dead code and noise removed:**

- `test/propagate/Maximum.ts`: removed unused `creatureD`/`creatureE`
  computations, debug file I/O, `console.log`, and global `DEBUG = true`
- `test/propagate/Minimum.ts`: same cleanup — removed dead
  `creatureD`/`creatureE` code, debug file I/O, `console.log`, and global
  `DEBUG = true`
- `test/propagate/Constants.ts`: removed dead `tmpActual` variable (used
  `actual` in its place), removed `console.info` calls
- `test/propagate/BackpropCoordination.ts`: removed global `DEBUG = true`
  mutation that leaked into parallel test runs
- `test/propagate/Recorder/ReplaySquash.ts`: removed commented-out
  `console.info` debug line

## Audit Summary

All test files across `test/propagate/` (root and subdirectories) have been
reviewed against the audit criteria:

- **Uniqueness**: No duplicate or near-duplicate tests remain
- **Behavioural testing**: All tests verify outcomes, not implementation details
- **Meaningful tests**: All tests have real assertions on real code
- **Organisation**: Test names clearly describe the behaviour being verified

This is the tenth PR in the audit series:

- PR #1787: Consolidated and improved propagation module tests
- PR #1788: Fixed vague test names, trivial tests, and missing assertions
- PR #1789: Remaining vague test names and missing assertions
- PR #1790: Final pass on test names and misleading filename
- PR #1791: Removed duplicate tests and standardised batch test names
- PR #1792: Removed duplicate WASM batch test files
- PR #1793: Fixed broken Identity.ts test with missing assertions
- PR #1794: Fixed assertion quality issues
- PR #1795: Removed duplicate tests, dead code, and missing assertions
- This PR: Final audit — removed last commented-out dead code

## Evidence

All 4776 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Verified no tests were broken by deletions (removed tests are already covered
  by existing tests in `Bias.ts`, `Weight.ts`, `BiasTypedErrors.ts`)
- Added meaningful assertions to the self-loop test in
  `TopologicalBackpropagation.ts`
- Full test suite passes (4776 tests, 0 failures)
