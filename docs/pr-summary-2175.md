## Summary

Add an input-weight crossover strategy for genetically incompatible creatures.
When two parents have zero shared neuron UUIDs (genetic compatibility below the
new `interSpeciesCrossoverThreshold`, default 0.1), the standard neuron-grafting
crossover is replaced with a strategy that preserves the mother's full topology
and blends input/output connection weights from both parents. This produces more
meaningful gene transfer for creatures from different islands (e.g., Europa
newcomers breeding with the general population). Closes #2175.

## Changes

- **`src/breed/InputWeightCrossover.ts`** (new): Implements the input-weight
  crossover strategy — clones the mother's topology, aligns father neurons via
  cosine similarity, blends input and output connection weights with a
  mother-biased factor (alpha 0.6-0.9), and optionally adds father's unique
  input connections at reduced weight.
- **`src/config/NeatArguments.ts`**: Added `interSpeciesCrossoverThreshold`
  field.
- **`src/config/NeatConfig.ts`**: Parses `interSpeciesCrossoverThreshold`
  (default 0.1).
- **`src/config/NeatOptions.ts`**: Added to numeric option keys for CLI
  coercion.
- **`src/config/NeatConfigValidation.ts`**: Added cross-field validation
  ensuring `interSpeciesCrossoverThreshold` does not exceed
  `geneticCompatibilityThreshold`.
- **`src/architecture/Offspring.ts`**: Early-return path in `breed()` that
  routes to `inputWeightCrossover()` when compatibility is below the
  inter-species threshold, with memetic update, hyperparameter crossover, and
  orphan pruning applied to the offspring (matching the standard crossover
  path).
- **`src/breed/Breed.ts`**: Passes `interSpeciesCrossoverThreshold` from config
  to `Offspring.breed()`.

## Evidence

All existing tests pass with 0 failures. No regression for compatible or
partially compatible breeding pairs.

## Test Plan

- Added `test/breed/InputWeightCrossover.ts` with 13 tests:
  - Verifies incompatible parents have zero genetic compatibility
  - Verifies offspring preserves mother's topology (neuron count and UUIDs)
  - Verifies input connection weights are blended from both parents
  - Verifies offspring passes `creatureValidate`
  - Verifies forward-only offspring passes validation
  - Verifies `Offspring.breed` uses input-weight crossover when threshold is set
  - Verifies standard crossover for partially compatible parents (no regression)
  - Verifies large input space (50 inputs, simulating GRQ-25-1/Europa scale)
  - Verifies mother-biased blending produces weights closer to mother
  - Verifies fully compatible creatures breed normally (no regression)
  - Verifies `interSpeciesCrossoverThreshold` config defaults to 0.1
  - Verifies config validation rejects threshold exceeding compatibility
  - Verifies graceful handling of creatures with no hidden neurons
