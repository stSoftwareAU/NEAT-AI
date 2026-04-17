## Summary

Split breeding wall-time from overlapped main-thread work to clarify phase
timing semantics. Closes #2323.

With phase pipelining (#2314), `breedingMs` measures wall-clock time from
starting `breedBatch()` until `await breedingPromise` resolves — which includes
concurrent main-thread work (result processing, plateau/MCMC configuration,
mutator/deduplicator setup). This made it impossible to distinguish pure
crossover cost from overlapped work.

**New fields on `GenerationPhaseTiming`:**

- `breedingWorkerMs` — actual worker/breeding duration (promise start to promise
  resolution)
- `mainThreadOverlapMs` — main-thread work done concurrently with worker
  breeding

The existing `breedingMs` field is preserved unchanged for backward
compatibility with dashboards and scripts.

## Evidence

This is a backend/timing instrumentation change with no visual output. Verified
via:

- All 5896 tests pass (0 failures, 3 ignored)
- New test file `test/NEAT/BreedingTimingSplit.ts` validates presence, types,
  non-negativity, semantic invariants, backward compatibility, and timing
  invariant consistency
- Existing timing tests (`EvolvePhaseTiming.ts`,
  `EvolvePhaseTiming_Extended.ts`, `PhasePipelining.ts`) continue to pass

## Test Plan

- Added `test/NEAT/BreedingTimingSplit.ts` with 4 tests:
  - `breedingWorkerMs and mainThreadOverlapMs are present` — verifies both
    fields exist and are non-negative numbers
  - `semantic invariants hold between timing fields` — checks
    `breedingMs >= breedingWorkerMs` and `breedingMs >= mainThreadOverlapMs`
  - `fields are optional for backward compatibility` — type-level verification
    that `GenerationPhaseTiming` accepts objects without the new fields
  - `timing invariant holds with new fields included` — confirms
    `totalMs >= sum(phases) - overlap` still holds
- Updated `test/NEAT/EvolvePhaseTiming_Extended.ts` to include new fields in the
  optional-fields validation loop
