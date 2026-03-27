## Summary

Merge milestone 'Performance Improvements' to Develop. This consolidates all six
performance-related issues into the main development branch. Closes #2062.

### Issues included

- #2042: Perf: Eliminate array slice + findIndex in Score.ts hot path
- #2043: Perf: Avoid unnecessary array copy in Fitness.ts topology grouping
- #2044: Perf: Reduce allocations in ModWeight mutation focus filtering
- #2045: Perf: Cache non-expansion mutation candidates in Mutator
- #2046: Perf: Pool Float64Array allocations in score extraction functions
- #2047: Perf: Reduce JSON serialisation overhead in worker communication

## Evidence

All individual issues were reviewed and merged into the milestone branch via
separate PRs (#2048, #2057, #2058, #2059, #2060, #2061). Each PR included
benchmark results demonstrating measurable performance improvements.

## Test Plan

- All existing tests pass with the consolidated changes
- Fixed spellcheck CI failure by renaming abbreviated variable names in
  `test/multithreading/WorkerSerialisationDirect.ts`
- New tests added by individual PRs:
  - `test/architecture/Score.ts`
  - `test/architecture/FitnessTopologySetup.ts`
  - `test/mutate/ModWeightFocus.ts`
  - `test/NEAT/MutatorNonExpansionCache.ts`
  - `test/score/ScoreExtractionPool.ts`
  - `test/multithreading/WorkerSerialisationDirect.ts`
