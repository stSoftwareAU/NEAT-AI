## Summary

Remove duplicate WASM batch accumulation test files from the propagation module.
Addresses #1766.

`WasmAccumulateBias.ts` (5 tests) and `WasmAccumulateWeight.ts` (5 tests) were
near-duplicates of `AccumulateBiasBatch.ts` and `AccumulateWeightBatch.ts`
respectively. Both file pairs called the same `accumulateBiasBatch4Way/8Way` and
`accumulateWeightBatch4Way/8Way` functions with identical or near-identical test
data and assertions. The WASM acceleration is dispatched transparently inside
these batch functions, so the "WASM" tests exercised the exact same code paths
as the existing batch tests.

The one unique test (`wasmCalculateWeight`) only asserted that the return value
was finite — this behaviour is already comprehensively tested in `Weight.ts`,
`WeightConvergence.ts`, `GenerationalDampening.ts`, and
`SingleLearningRateApplication.ts`.

This is the sixth and final PR in the audit series:

- PR #1787: Consolidated and improved propagation module tests
- PR #1788: Fixed vague test names, trivial tests, and missing assertions
- PR #1789: Remaining vague test names and missing assertions
- PR #1790: Final pass on test names and misleading filename
- PR #1791: Removed duplicate tests and standardised batch test names
- This PR: Remove remaining duplicate WASM batch test files

All 85 remaining test files (465+ test cases) in `test/propagate/` were reviewed
and verified to meet all audit criteria:

- No duplicate tests remain
- All tests verify behaviour, not implementation details
- All tests are meaningful with real assertions
- Test names clearly describe the behaviour being verified

## Evidence

All 4788 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Removed `test/propagate/WasmAccumulateBias.ts` (5 duplicate tests)
- Removed `test/propagate/WasmAccumulateWeight.ts` (5 duplicate tests, 1
  trivial)
- Verified no other files import from the removed files
- Full test suite passes (4788 tests, 0 failures)
