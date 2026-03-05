## Summary

Replace generic `throw new Error(...)` with typed error classes and `console.warn` with Logger abstraction across breed, mutate, blackbox, NEAT, and other modules. Closes #1695.

**Error replacements (19 instances across 13 files):**

- **ValidationError**: breed/FitnessRanking, breed/ParentSelection, blackbox/RestoreSource, blackbox/FineTunePopulation (6 throws), NEAT/LogApproach, NEAT/Mutator (createOperator, selectMutationMethod), Costs, utils/RandomNumberGenerator (2 throws)
- **TopologyError**: mutate/AddConnection (2 throws), mutate/AddNeuron (2 throws), NEAT/Mutator (repairAfterMutation forward-only 4.x violation), optimize/Simplify
- **Logger**: config/NeatConfig and config/NeatConfigValidation `console.warn` replaced with `getLogger().warn`

Part of #1691 (third batch of error handling improvements).

## Evidence

This is a backend/internal change with no UI impact. All 4377 tests pass, including updated typed error assertions. No screenshots needed.

## Test Plan

- Updated `test/breed/FitnessRanking.ts` to assert `ValidationError` instead of `Error` for empty population
- Updated `test/Costs.ts` to assert `ValidationError` for unknown cost function
- Updated `test/utils/RandomNumberGenerator.ts` to assert `ValidationError` for empty array choice
- Updated `test/NEAT/MutatorMutateCreature.ts` to assert `ValidationError` for unknown mutation method
- Added `test/errors/TypedErrorReplacements.ts` with dedicated tests for typed error throws
- All 4377 tests pass with `./quality.sh`
