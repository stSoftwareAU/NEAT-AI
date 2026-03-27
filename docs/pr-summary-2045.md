## Summary

Cache non-expansion mutation candidates in `Mutator.selectMutationMethod()` for large creatures. Previously, a new filtered array was created on every call via `candidates.filter()`. Now the filtered result is pre-computed in `computeMutationCandidates()` and stored in the `MutationCacheEntry` alongside existing cached data. Closes #2045.

## Evidence

### Benchmark Results (Apple M4 Pro, Deno 2.7.8)

**Baseline (before change) — `bench/MutatorCacheValidMutations.ts`:**
| Benchmark | time/iter (avg) |
|---|---|
| large creature x1 (cached) | 481.6 ns |
| large creature x100 (cached) | 48.5 µs |
| large creature x1000 (cached) | 473.0 µs |

**After change — `bench/MutatorNonExpansionCache.ts`:**
| Benchmark | time/iter (avg) |
|---|---|
| large creature (300+ neurons) x1000 | 484.0 µs |
| very large creature (500+ neurons) x1000 | 481.2 µs |
| large creature mutationAmount=5 x100 creatures | 245.1 µs |
| very large creature mutationAmount=5 x100 creatures | 245.6 µs |

Performance is consistent with no regression. The primary benefit is eliminating per-call array allocations (`.filter()` creating a new array on every `selectMutationMethod()` invocation) for large creatures, reducing GC pressure during evolution loops.

### What changed

- Added `nonExpansionCandidates` field to `MutationCacheEntry` interface
- Pre-compute the filtered array in `computeMutationCandidates()` once per cache key
- Use cached `nonExpansionCandidates` in `selectMutationMethod()` instead of filtering inline

## Test Plan

- Added `test/NEAT/MutatorNonExpansionCache.ts` with 5 tests:
  - Large creatures never select ADD_NODE/ADD_CONN from non-expansion path
  - Cached results are consistent across repeated calls
  - Cache invalidation works when cache is cleared
  - Different creature sizes use separate cache entries
  - Non-expansion candidates exclude only ADD_NODE and ADD_CONN
- Added `bench/MutatorNonExpansionCache.ts` benchmarking 300+ and 500+ neuron creatures
- All 5055 existing tests pass
