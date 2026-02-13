## Summary

Add leave-one-out combination strategy and extend pairwise/triple coverage for
larger candidate sets when combining successful discovery candidates. Closes
#1417.

**Problem**: When multiple successful discovery candidates exist, two
"aggressive" candidates may look good individually but score negatively
together. The previous implementation only generated pairwise combinations for
sets of up to 10 candidates and triples for sets of 4-8, leaving larger
candidate sets with only the "all combined" strategy.

**Solution**: Three improvements to `buildCombinedFromSuccessful()`:

1. **Strategy 6: Leave-one-out combinations** - For 3+ successful candidates,
   generate N combinations each excluding one candidate (size N-1). This
   directly addresses the concern about aggressive candidates by testing what
   happens when each candidate is removed from the full set. This is O(N) and
   runs in parallel.

2. **Extended pairwise** - Remove the upper bound of 10 candidates for pairwise
   combinations. For sets larger than 10, sample the top 10 candidates (already
   sorted by score delta from `pruneSuccessfulCandidatesForCombos`).

3. **Extended triples** - Remove the upper bound of 8 candidates for triple
   combinations. For sets larger than 8, sample the top 8 candidates.

The `seenCombinations` set prevents duplicate combinations across strategies
(e.g., leave-one-out of size 2 with 3 candidates deduplicates with pairwise).

## Evidence

This is a backend/algorithmic change with no visual output.

**Before** (12 successful candidates): 1 combination generated (only "all
combined") **After** (12 successful candidates): 114 combinations generated
(all + 45 sampled pairs + 56 sampled triples + 12 leave-one-out)

All 2685 existing tests pass with 0 failures.

## Test Plan

- Added `test/discovery/LeaveOneOutCombinations.ts` with 6 tests:
  - `generates leave-one-out combinations for 3+ candidates`
  - `generates leave-one-out combinations for 4 candidates`
  - `leave-one-out with 5 candidates produces size-4 subsets`
  - `leave-one-out avoids duplicate with all-combined`
  - `extended pairwise sampling for > 10 candidates` (was failing before fix)
  - `leave-one-out combinations each exclude exactly one candidate`
- All existing combination tests pass unchanged (43 related tests)
