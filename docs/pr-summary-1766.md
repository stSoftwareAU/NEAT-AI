## Summary

Final audit pass on propagation module tests: fixed a broken test in
`Identity.ts` that had no meaningful assertions and was silently passing due to
a WASM activation issue (in-place neuron bias mutation doesn't propagate to the
WASM engine). Addresses #1766.

## Changes

- **test/propagate/Identity.ts**: Rewrote both tests to use the correct
  export-modify-recreate pattern (consistent with the rest of the test suite).
  Test 1 ("backprop reduces error after bias perturbation") previously had NO
  assertion verifying that error improved — it only printed to console. It also
  mutated `neuron.bias` in-place, which has no effect on WASM activation. Now it
  exports JSON, perturbs biases, recreates the creature, trains, and asserts
  error improvement. Test 2 ("backprop produces minimal change") was similarly
  cleaned up to use `DataRecordInterface` and clearer variable names.

## Audit Summary

All 83 test files across `test/propagate/` (root and subdirectories) were
reviewed against the audit criteria:

- **Uniqueness**: No duplicate or near-duplicate tests remain
- **Behavioural testing**: All tests verify outcomes, not implementation details
- **Meaningful tests**: All tests have real assertions on real code
- **Organisation**: Test names clearly describe the behaviour being verified

This is the seventh PR in the audit series:

- PR #1787: Consolidated and improved propagation module tests
- PR #1788: Fixed vague test names, trivial tests, and missing assertions
- PR #1789: Remaining vague test names and missing assertions
- PR #1790: Final pass on test names and misleading filename
- PR #1791: Removed duplicate tests and standardised batch test names
- PR #1792: Removed duplicate WASM batch test files
- This PR: Fixed broken Identity.ts test with missing assertions

## Evidence

- `deno fmt`, `deno lint`, `deno check` all pass
- All propagation tests pass (26 backprop-related tests confirmed)
- Identity.ts tests pass with meaningful assertions

## Test Plan

- Verified both Identity.ts tests pass with
  `deno test --allow-all test/propagate/Identity.ts`
- Ran `./quality.sh --lint-only` and `./quality.sh --check-only` — both pass
- Ran broader `--filter "backprop"` test suite — all 26 tests pass
