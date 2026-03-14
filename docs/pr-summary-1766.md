## Summary

Final quality pass on propagation module test audit: fixed remaining assertion
quality issues across 4 test files found during comprehensive review of all 84
test files (~455 test cases). Addresses #1766.

## Changes

- **ActivationRangeTypedErrors.ts**: Replaced manual
  `if (ae.reason !== ...) throw new Error(...)` patterns with `assertEquals()`
  across all 4 tests for consistent, idiomatic assertions
- **LimitBias.ts**: Fixed assertion message referencing wrong variable (`bias`
  instead of `bias2`)
- **Trace.ts**: Removed leftover `console.info(nodeState)` debug output
- **SingleNeuron.ts**: Fixed test with impossible fail condition (`loop > 12` in
  a loop running 0–4, making the test a permanent no-op). Replaced with
  meaningful before/after error comparison verifying that training reduces
  prediction error

## Audit Summary

All 84 test files across `test/propagate/` (root and subdirectories) were
reviewed against the audit criteria:

- **Uniqueness**: No duplicate or near-duplicate tests remain
- **Behavioural testing**: All tests verify outcomes, not implementation details
- **Meaningful tests**: All tests have real assertions on real code
- **Organisation**: Test names clearly describe the behaviour being verified

This is the eighth PR in the audit series:

- PR #1787: Consolidated and improved propagation module tests
- PR #1788: Fixed vague test names, trivial tests, and missing assertions
- PR #1789: Remaining vague test names and missing assertions
- PR #1790: Final pass on test names and misleading filename
- PR #1791: Removed duplicate tests and standardised batch test names
- PR #1792: Removed duplicate WASM batch test files
- PR #1793: Fixed broken Identity.ts test with missing assertions
- This PR: Fixed assertion quality issues (manual checks, wrong variables, debug
  output, no-op test)

## Evidence

- `deno fmt`, `deno lint`, `deno check` all pass
- Full test suite passes (4788 tests, 0 failures)
- The SingleNeuron.ts fix is the most significant: the original test could never
  fail because the condition `if (loop > 12)` was unreachable inside a loop
  bounded to 0–4

## Test Plan

- `test/propagate/ActivationRangeTypedErrors.ts` — 4 tests updated to use
  assertEquals
- `test/propagate/LimitBias.ts` — assertion message corrected
- `test/propagate/Trace.ts` — debug output removed
- `test/propagate/SingleNeuron.ts` — no-op test replaced with meaningful
  assertion
- Full test suite (4788 tests) passes
