## Summary

Final audit pass of all ~86 test files (~500+ test cases) in the propagation
module (`test/propagate/`). Fixed remaining vague test names and renamed a
misleading test file. Addresses #1766.

This is the fourth and final PR in the audit series:

- PR #1787: Consolidated and improved propagation module tests
- PR #1788: Fixed vague test names, trivial tests, and missing assertions
- PR #1789: Remaining vague test names and missing assertions
- This PR: Final pass - last vague names and misleading filename

## Changes

### Vague test names replaced with descriptive behaviour descriptions:

- **AccumulateBias.ts**: "AccumulateBias-Standard" → "accumulateBias - positive
  delta accumulates bias correctly"
- **AccumulateBias.ts**: "AccumulateBias-Limited" → "accumulateBias - large delta
  is clamped by adjustment limit"
- **NoChangeWhenCorrect.ts**: "NoChangeWhenCorrect" → "propagation does not alter
  activations when output already matches target"

### Misleading test filename renamed:

- **sparse/BuildSynapseMapBenchmark.ts** → **sparse/BuildSynapseMapCorrectness.ts**:
  File only contains correctness verification tests (performance benchmarks were
  previously moved to `bench/`). AGENTS.md guidelines say to avoid "Benchmark" or
  "Performance" in test file names.

## Evidence

- All 4824 tests pass
- `./quality.sh` passes cleanly

## Test Plan

- No new test files added; existing tests renamed for clarity
- All existing test logic preserved unchanged
