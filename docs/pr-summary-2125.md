## Summary

Cache non-expansion mutation candidates in `Mutator.ts` to eliminate per-call
`.filter()` array allocations for large creatures. Closes #2125.

Added a `nonExpansionCandidates` field to `MutationCacheEntry` that is
pre-computed once per cache key in `computeMutationCandidates()`.
`selectMutationMethod()` now reads from the cached array instead of filtering
candidates on every invocation.

## Evidence

Benchmark results (`bench/MutatorNonExpansionCache.ts`) for large creatures (65
neurons):

| Benchmark                          | Time/iter |
| ---------------------------------- | --------- |
| selectMutationMethod (single call) | 442 ns    |
| selectMutationMethod x100          | 44.6 us   |
| selectMutationMethod x1000         | 441.3 us  |

The optimisation removes a per-call `.filter()` allocation. The cached array is
computed once per unique cache key (creature size category), so repeated calls
during evolution loops no longer create throwaway filtered arrays.

## Test Plan

- Added `test/NEAT/MutatorNonExpansionCache.ts` with 4 tests:
  - Large creatures never select expansion mutations via non-expansion path
  - Cached non-expansion candidates are consistent across calls
  - Different creature sizes produce correct cache entries
  - `clearMutationCache` resets non-expansion candidates
- All 85 existing Mutator tests pass with no modifications
- Full quality gate passes (5191 tests, 0 failures)
