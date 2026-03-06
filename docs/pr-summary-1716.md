## Summary

Deprioritise already-successful removal candidates during filtering so the
discovery process prefers novel (untried) removal candidates over ones that have
already succeeded in previous rounds. This reduces redundant evaluations across
distributed discovery machines. Closes #1716.

When a success cache directory is configured, Phase 3 of
`filterCandidatesForEvaluation()` now:

1. Queries the success cache for neuron UUIDs that have already succeeded
2. Partitions the lowest-impact removal pool into novel vs already-successful
3. Fills removal slots from novel candidates first, falling back to
   already-successful ones only when there are not enough novel candidates
4. Reports the novel/already-successful split in diagnostics

Behaviour is unchanged when no success cache directory is configured (backwards
compatible).

## Evidence

This is a backend/algorithmic change with no UI. All 4580 tests pass, including
6 new tests covering the success cache deprioritisation logic.

## Test Plan

New tests in `test/discovery/CandidateFilteringSuccessCache.ts`:

- Novel removal candidates are preferred over already-successful ones
- Already-successful candidates serve as fallback when novel candidates are
  insufficient
- Behaviour is unchanged when no success cache dir is provided
- Diagnostics include novelCount and alreadySuccessfulCount
- Harmful neuron candidates are also deprioritised by success cache
- No diagnostics novelCount when no successCacheDir is provided
