## Summary

Audit all 34 test files (~380+ test cases) in `test/mutate/` for quality standards: uniqueness, behavioural testing, meaningful assertions, and organisation. Closes #1769.

### Changes made

1. **Removed duplicate `test/mutate/MutationStabilityTracker.ts`** (13 tests) — every test case was a near-duplicate of `test/NEAT/MutationStabilityTrackerBehavioural.ts` (21 tests), which provides strictly more comprehensive coverage.

2. **Consolidated `test/mutate/SwapNodes.ts`** (3 tests) into `test/mutate/SwapNeuronsBehavioural.ts` (7 tests):
   - `SwapNodes-Constant` and `SwapNodes-Short` were duplicates of the existing "returns false with fewer than 2 hidden neurons" tests.
   - `SwapNodes-Valid` (UUID recomputation after swap) was a unique, valuable test — merged into `SwapNeuronsBehavioural.ts` as "recomputed UUID changes after successful swap".
   - Fixed the existing UUID test which was checking a stale cached UUID instead of recomputing it.

3. **Renamed `test/mutate/ConnectSpliceBenchmark.ts`** to `test/mutate/ConnectSplice.ts` — per AGENTS.md convention to avoid "Benchmark" in test file names (the file tests correctness, not performance).

4. **Cleaned up implementation-detail tests in `test/mutate/AvailableConnectionsCache.ts`**:
   - Removed "returns cached results" test (only assertion was reference equality — an implementation detail).
   - Removed "isAvailableConnectionsCacheBuilt returns correct state" test (tested internal cache state, not behaviour).
   - Removed "cache invalidates after clearCache()" test (only tested reference inequality).
   - Removed reference-inequality assertions from remaining tests; replaced with meaningful behavioural assertions (correct counts, valid connection properties).

### Cross-area duplicates noted

- `test/NEAT/MutatorMutateCreature.ts` and `test/NEAT/MutatorBehavioural.ts` test individual mutation operators (ADD_NODE, MOD_WEIGHT, etc.) at the integration level. These are NOT duplicates of `test/mutate/` — they test the Mutator orchestration layer, not the individual operators.
- `test/NEAT/MutationStabilityTrackerBehavioural.ts` fully supersedes the removed `test/mutate/MutationStabilityTracker.ts`.

### Remaining 31 test files

All remaining files in `test/mutate/` were reviewed and found to meet quality standards:
- All tests verify behaviour/outcomes, not implementation details
- All tests have meaningful assertions
- Test names clearly describe the behaviour being verified
- No further duplicates found

## Evidence

- All 4731 tests pass
- `./quality.sh` passes clean

## Test Plan

- Verified no test regressions: 4731 passed, 0 failed
- The removed/consolidated tests' coverage is maintained by existing tests in the suite
