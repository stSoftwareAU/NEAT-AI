## Summary

Add comprehensive unit tests for the two core NEAT algorithm files: `Neat.ts`
(evolution orchestrator) and `Mutator.ts` (mutation engine). Closes #1397.

Ten new test files covering 76 tests verify constructor initialisation,
population management, evolution loop behaviour, mutation candidate filtering,
single-creature mutation, and mathematical correctness:

### Neat.ts tests (5 files, 36 tests)

1. **NeatConstruction.ts** (12 tests): Verifies constructor initialisation
   including input/output dimensions, population from creatures option, frozen
   config, plateau detector, fine-tune tracker, discovery replay queue, worker
   pool, timeout handling, CRISPRs default, and setDataDir.

2. **NeatDeepCloneAndShuffle.ts** (7 tests): Tests the static
   `deepCloneAndShuffle` utility for empty arrays, single elements, deep cloning
   (reference independence), mutation independence, element preservation,
   shuffling behaviour, and complex object handling.

3. **NeatPopulatePopulation.ts** (6 tests): Verifies population is filled to
   configured size, seed creature placement, UUID assignment, correct
   input/output dimensions, diversity via mutation, and integration with
   existing population.

4. **NeatFinishUp.ts** (3 tests): Tests finish-up logic including return value
   with no in-progress work, doNotStartMore flag setting, and idempotent
   behaviour on multiple calls.

5. **NeatEvolve.ts** (8 tests): Tests evolution loop including fittest creature
   scoring, plateau detection status, average score calculation, population
   repopulation, UUID assignment, multi-generation fitness maintenance, plateau
   detector recording, and elitism preservation.

### Mutator.ts tests (5 files, 40 tests)

1. **MutatorMutate.ts** (7 tests): Tests population-level mutation at various
   rates (1.0, very low), empty population handling, dimension preservation,
   tag clearing, multiple mutation amounts, and single-creature mutation.

2. **MutatorMutateCreature.ts** (12 tests): Tests individual mutation methods
   (MOD_WEIGHT, MOD_BIAS, ADD_NODE, SUB_NODE, ADD_CONN, MOD_SQUASH, SWAP_NODES),
   unknown mutation error handling, forward-only constraint preservation, 4.x
   semantic version enforcement, post-mutation validation, and feedbackLoop
   interaction with forwardOnly.

3. **MutatorCalculateMaxSynapses.ts** (8 tests): Mathematically verifies
   maximum synapse calculation for various network topologies including no
   hidden neurons, single/dual/many hidden, single obs/output, zero
   observations, large networks, and symmetry.

4. **MutatorComputeMutationCandidates.ts** (9 tests): Tests mutation candidate
   filtering for forward-only creatures, 4.x semantic version, SUB_NODE without
   hidden neurons, SWAP_NODES with insufficient hidden, ADD_NODE at maximum
   nodes, ADD_NODE below maximum, valid method guarantee, MOD_WEIGHT/MOD_BIAS
   availability, and cache clearing.

5. **MutatorArrayEquals.ts** (4 tests): Tests focus list-based mutation
   behaviour including focused mutation, unfocused mutation, mixed focus rate,
   and high mutation amount with focus list.

## Evidence

This is a test-only change with no source code modifications. All 2668 tests
pass (including 76 new tests across ten files):

```
ok | 2668 passed (2 steps) | 0 failed
```

## Test Plan

- Added `test/NEAT/NeatConstruction.ts` — 12 tests for Neat constructor
- Added `test/NEAT/NeatDeepCloneAndShuffle.ts` — 7 tests for deep clone utility
- Added `test/NEAT/NeatPopulatePopulation.ts` — 6 tests for population filling
- Added `test/NEAT/NeatFinishUp.ts` — 3 tests for finish-up logic
- Added `test/NEAT/NeatEvolve.ts` — 8 tests for evolution loop
- Added `test/NEAT/MutatorMutate.ts` — 7 tests for population-level mutation
- Added `test/NEAT/MutatorMutateCreature.ts` — 12 tests for single-creature mutation
- Added `test/NEAT/MutatorCalculateMaxSynapses.ts` — 8 tests for max synapse calculation
- Added `test/NEAT/MutatorComputeMutationCandidates.ts` — 9 tests for mutation candidate filtering
- Added `test/NEAT/MutatorArrayEquals.ts` — 4 tests for focus list mutation behaviour
