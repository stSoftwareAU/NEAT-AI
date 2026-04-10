## Summary

Add per-generation timing diagnostics to the evolution loop so that slow phases
can be identified when debugging performance. Closes #2239.

The `evolve()` function in `NeatEvolution.ts` now measures the duration of three
key phases — fitness evaluation, parallel breeding, and result processing — using
lightweight `Date.now()` calls. The timing data is:

- Returned from `evolve()` as a `phaseTiming` field
- Included in every `generation_complete` training event via a new
  `GenerationPhaseTiming` interface
- Logged to the console when `config.verbose` is enabled

There is no performance impact when verbose is disabled — the only overhead is
three `Date.now()` calls per generation (no allocations, no string formatting).

## Evidence

- All 5686 existing tests pass with zero failures
- New test `test/NEAT/EvolvePhaseTiming.ts` verifies that every
  `generation_complete` event includes `phaseTiming` with non-negative values for
  `fitnessMs`, `breedingMs`, `resultProcessingMs`, and `totalMs`

## Test Plan

- Added `test/NEAT/EvolvePhaseTiming.ts` — runs a small evolution, collects
  `generation_complete` events, and asserts the `phaseTiming` field is present
  with valid numeric values and that `totalMs >= sum of phases`
