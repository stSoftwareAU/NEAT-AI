## Summary

Removed timing-based assertions (`performance.now()`) from two unit test files
and replaced them with behavioural assertions that verify correctness rather than
performance. Closes #1446.

Per AGENTS.md guidelines, unit tests must not use timing APIs since tests run in
parallel, making performance measurements unreliable. The performance properties
are already covered by existing benchmarks (`bench/ScoreCalculationCache.ts` and
`bench/AvailableConnectionsCache.ts`).

### Changes

- **`test/score/ScoreCacheWeightBias.ts`**: Replaced the
  "performance - caching should avoid redundant iterations" test with a
  behavioural test that verifies the cache reference persists across 100
  calculations with varying error values — confirming the cache is reused without
  relying on timing.

- **`test/mutate/AddConnectionOptimisation.ts`**: Replaced the
  "performance with large creature" test with a behavioural test that verifies
  mutation correctness at scale — checking creature validity and that synapse
  counts match the number of successful mutations, rather than timing the
  operations.

## Evidence

This is a test-only change with no UI or performance implications. Existing
benchmarks in `bench/ScoreCalculationCache.ts` and
`bench/AvailableConnectionsCache.ts` already cover the performance aspects that
were previously (unreliably) tested in unit tests.

All 3291 tests pass with 0 failures after the changes.

## Test Plan

- Modified `test/score/ScoreCacheWeightBias.ts` — replaced timing test with
  cache persistence behavioural test
- Modified `test/mutate/AddConnectionOptimisation.ts` — replaced timing test
  with mutation correctness behavioural test
- Ran `./quality.sh` — all formatting, linting, type-checking, and 3291 tests
  pass
