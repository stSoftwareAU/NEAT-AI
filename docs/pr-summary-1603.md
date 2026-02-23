## Summary

Convert implementation-detail tests to behavioural "what" tests across three
Mutator test files. Closes #1603.

### Changes

1. **`test/NEAT/MutatorInstanceCache.ts`** — Removed 5 tests that asserted on
   internal WeakMap caching (object reference identity, cache instance counts,
   GC semantics). Replaced with 4 behavioural tests that verify: mutation
   produces structurally valid creatures, all configured mutation types can be
   applied, mutations across different creatures produce independent results,
   and population mutation works correctly. Kept 2 existing behavioural tests
   (error on unknown mutation type, repeated mutations succeed).

2. **`test/NEAT/MutatorComputeMutationCandidates.ts`** — Replaced the "cache is
   cleared properly" test (which called `mutator.clearMutationCache()` directly)
   with a behavioural test that verifies mutation selection adapts correctly to
   different creature states (hidden neurons present vs absent).

3. **`test/NEAT/MutatorSelectMutationMethod.ts`** — Removed hardcoded coupling
   to exact internal list sizes (`0.8125` derived from "2 weight/bias out of 8
   total" in FFW). Replaced with behavioural assertions: weight/bias mutations
   dominate (> 50%), structural mutations still appear (< 99% weight/bias), and
   all non-structural mutation types are exercised.

## Evidence

This is a backend/test-only change with no UI. All 19 tests pass:

- 6 tests in `MutatorInstanceCache.ts`
- 9 tests in `MutatorComputeMutationCandidates.ts`
- 4 tests in `MutatorSelectMutationMethod.ts`

Note: One pre-existing test failure in `TrainingLoopAllocations.ts` is unrelated
to these changes.

## Test Plan

- Verified all 19 converted tests pass with `deno test --allow-all`
- Confirmed no test directly inspects internal caching mechanisms (WeakMap
  identity, cache clearing)
- Confirmed no test is coupled to exact internal list sizes or implementation
  constants
- All tests verify observable outcomes: correct results, valid state, expected
  side effects
