## Summary

Implement Metropolis-Hastings acceptance criterion for creature mutations, gated
behind `mcmc.enabled`. When enabled, weight/bias mutations are probabilistically
accepted based on a proxy cost delta and the current MCMC temperature, while
topology mutations are always accepted unconditionally. Temperature cools each
generation following the configured exponential schedule. CompactCreature weight
rescaling also supports probabilistic acceptance when MCMC temperature is
provided. Existing behaviour is unchanged when `mcmc.enabled` is `false`. Closes
#2200.

## Changes

- **`src/NEAT/MCMCState.ts`** (new): Tracks current MCMC temperature with
  exponential cooling schedule per generation
- **`src/NEAT/MetropolisHastings.ts`** (new): Standalone M-H acceptance
  function, lightweight weight/bias penalty proxy for Creature objects, and
  topology mutation classifier
- **`src/NEAT/Mutator.ts`**: Accepts optional `mcmcTemperature` in constructor;
  tracks mutation types per creature; applies M-H acceptance after
  weight/bias-only mutation batches with revert-to-snapshot on rejection
- **`src/compact/CompactCreature.ts`**: `simplifyLargeWeights()` accepts
  optional MCMC temperature; worsening rescalings accepted with probability
  `exp(-delta/T)` instead of greedy rejection
- **`src/NEAT/Neat.ts`**: Initialises `MCMCState` from config
- **`src/NEAT/NeatEvolution.ts`**: Passes current temperature to Mutator; cools
  temperature after each generation
- **`src/Creature.ts`**: `compact()` accepts optional `mcmcTemperature`
  parameter

## Evidence

- All 5398 existing tests pass with zero failures
- `./quality.sh --skip-wasm --skip-discovery` passes cleanly (fmt, lint,
  type-check, all tests)
- New tests verify M-H acceptance behaviour across temperature ranges

## Test Plan

- `test/NEAT/MCMCState.ts` (5 tests): Temperature initialisation, cooling
  schedule, min floor, reset, multi-generation cooling
- `test/NEAT/MetropolisHastings.ts` (13 tests): Improving/zero delta always
  accepted, zero temp rejects, low temp approximates greedy, high temp accepts
  most, precise acceptance threshold, large delta low acceptance, topology
  mutation classification, weight/bias penalty computation
- `test/NEAT/MutatorMCMCAcceptance.ts` (4 tests): MCMC disabled preserves
  existing behaviour, M-H rejection reverts creature, topology mutations
  accepted at any temperature, high temperature accepts most mutations
