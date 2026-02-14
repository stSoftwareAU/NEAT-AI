## Summary

Add behavioural tests for the core NEAT algorithm files that had no direct unit test coverage. These tests verify outcomes (the "what") rather than implementation details (the "how"), ensuring regressions in the evolutionary engine are caught early. Closes #1439.

## Test Files Added

### `test/NEAT/NeatBehavioural.ts` (9 tests)
- Verifies `evolve()` improves fitness over generations for XOR
- Verifies speciation separates genetically distant creatures
- Verifies cloned creatures are grouped in the same species
- Verifies species key is deterministic
- Verifies genus validates creature-species mapping
- Verifies elitism preserves top performers between generations
- Verifies population size stays within configured bounds
- Verifies `populatePopulation` creates correct population size with correct dimensions
- Verifies population contains valid creatures after evolution

### `test/NEAT/MutatorBehavioural.ts` (21 tests)
- Verifies mutation produces valid creatures (passes validation) for ADD_NODE, ADD_CONN, SUB_NODE, SUB_CONN, and all FFW methods
- Verifies ADD_NODE, ADD_CONN, SUB_NODE create expected structural changes
- Verifies MOD_WEIGHT and MOD_BIAS change the correct properties
- Verifies forward-only constraint preserved across multiple mutations
- Verifies semantic version 4.x enforces forward-only for non-topological mutations
- Verifies mutation rate configuration is honoured (high rate, low rate, mutation amount)
- Verifies `selectMutationMethod` returns valid mutations and prefers weight/bias for large creatures
- Verifies `calculateMaxSynapses` returns correct values
- Verifies batch mutation preserves creature dimensions

### `test/NEAT/PlateauDetectorBehavioural.ts` (11 tests)
- Verifies plateau detection triggers after stagnation
- Verifies plateau triggers after exactly windowSize generations
- Verifies plateau generation counter increments
- Verifies plateau resets when improvement resumes
- Verifies mutation multiplier increases on plateau and decreases during rapid improvement
- Verifies zero false positives during steady and variable improvement
- Verifies correct distinction between improvement and stagnation
- Verifies handling of negative-to-less-negative improvement
- Verifies `isImproving()` correctly detects rapid improvement

### `test/NEAT/MutationStabilityTrackerBehavioural.ts` (15 tests)
- Verifies stability tracking correctly identifies stable networks
- Verifies identification of brittle networks (above and below threshold)
- Verifies failed mutation tracking
- Verifies rolling window drops old entries
- Verifies empty tracker defaults to optimistic
- Verifies mutation magnitude multiplier (reduced for brittle, boosted for stable, neutral for mixed)
- Verifies score variance reclassification (high variance reclassifies stable as brittle)
- Verifies stability score reflects outcome quality
- Verifies per-type tracking isolates mutation types
- Verifies reset clears all tracking state

## Evidence

This is a test-only change with no UI or performance modifications. All 3123 tests pass (including 56 new tests) with `./quality.sh`:

```
ok | 3123 passed (2 steps) | 0 failed (28s)
```

## Test Plan

- Added 56 new behavioural tests across 4 test files
- All tests verify outcomes, not implementation details
- All tests pass in parallel alongside existing 3067 tests
- No existing tests were modified or removed
