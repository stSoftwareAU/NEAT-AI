## Summary

Final audit pass on compact/optimisation test files. Closes #1772.

Audited all test files in `test/Compact/`, `test/optimize/`,
`test/optimization/`, `test/FeedForward/`, and `test/reconstruct/` against the
quality criteria:

1. **Removed duplicate test file**: `test/FeedForward/MutateActions.ts` — all 3
   tests were duplicates of more thorough coverage in
   `test/NEAT/MutatorComputeMutationCandidates.ts` (which uses 500 iterations vs
   100 and covers additional scenarios like semantic version constraints and
   maximum node limits).

2. **Fixed inconsistent test pattern**:
   `test/reconstruct/ValidateDNATypedErrors.ts` — replaced manual try-catch with
   `assertThrows` for consistency with the other 3 tests in the same file.

3. **Consolidated trivial tests**: `test/Compact/IsAggregationSquash.ts` —
   consolidated 11 near-identical single-assertion tests into 3 data-driven
   tests that cover the same cases more concisely.

### Cross-area duplicates found

- `test/FeedForward/MutateActions.ts` duplicated
  `test/NEAT/MutatorComputeMutationCandidates.ts` and
  `test/NEAT/MutatorCacheValidMutations.ts` (removed)
- `test/reconstruct/ValidateDNATypedErrors.ts` overlaps with
  `test/CRISPR/ValidateDNA.ts` but provides unique error-type and error-code
  verification (kept)

## Evidence

- All 4509 tests pass
- `./quality.sh` passes cleanly

## Test Plan

- Verified `test/Compact/IsAggregationSquash.ts` consolidated tests cover all
  original cases
- Verified `test/reconstruct/ValidateDNATypedErrors.ts` assertThrows pattern
  works correctly
- Confirmed `test/NEAT/MutatorComputeMutationCandidates.ts` provides superset
  coverage of removed `MutateActions.ts`
- Full test suite passes (4509 tests, 0 failures)
