## Summary

Return multiple successful discoveries from the discovery runner instead of
only the single best. Previously, when multiple candidates improved on the
original creature, all but the best were discarded — forcing expensive
re-discovery in later runs. Now every successful candidate is returned so
the caller can add them to the population.

Closes #1732.

### Changes

- **`DiscoveryRunnerTypes.ts`**: Added `DiscoveryImprovement` interface
  (shared shape for primary and additional improvements) and
  `additionalImprovements` field on `DiscoveryDirResult`.
- **`DiscoveryRunner.ts`**: Refactored the final selection to collect all
  successful candidates, build the primary `improvement` from the best one,
  and populate `additionalImprovements` (sorted by score descending) from
  the rest. Re-exported `DiscoveryImprovement` for consumer use.
- **Backward compatible**: The `improvement` field continues to hold the
  single best result. `additionalImprovements` is only set when two or more
  candidates beat the original; otherwise it remains `undefined`.
- Success cache behaviour is unchanged — all successful singles were already
  cached before this change.

## Evidence

All 4637 existing tests pass, plus 5 new tests covering the feature.

## Test Plan

Added `test/discovery/DiscoveryRunnerMultipleImprovements.ts` with:

- Multiple candidates improve → `additionalImprovements` populated, sorted
  descending
- Only one candidate improves → `additionalImprovements` is `undefined`
- No candidates improve → both `improvement` and `additionalImprovements`
  are `undefined`
- Field validation on additional improvement entries (changeType, error,
  score, scoreDelta, message, creature)
- Primary improvement is not duplicated in `additionalImprovements`
