## Summary

Add integration tests for offspring quality metrics and edge cases in
inter-species breeding. Closes #2186.

A new companion test file `test/breed/InterSpeciesBreedingQuality.ts` covers:

- **Offspring quality**: verifies offspring differs meaningfully from mother
  (structural differences in neurons, synapses, or weights), inherits
  father-origin structural elements (transplanted neurons or blended weights),
  and maintains valid forward-only topology with no disconnected hidden neurons.
- **Memetic data handling**: tests memetic inheritance from mother (Europa with
  memetic, GRQ-25-1 without) and fallback from father (GRQ-25-1 mother without
  memetic, Europa father with). Validates that any memetic references point to
  neurons that exist in the offspring.
- **Edge cases**: asymmetric neuron counts in both directions (many-neuron
  father/few-neuron mother and vice versa), and multiple consecutive breedings
  (5 rounds) verifying each offspring passes `creatureValidate()`, parents
  remain unchanged, and offspring exhibit variety.

## Evidence

All 11 new tests pass in under 1 second total. Quality gate (lint, format,
type-check) passes cleanly.

## Test Plan

- `test/breed/InterSpeciesBreedingQuality.ts` — 11 tests:
  1. Offspring is not a clone of the mother (GRQ-25-1 mother)
  2. Offspring is not a clone of the mother (Europa mother)
  3. Offspring inherits structural elements from the father
  4. Offspring topology is valid — forward-only, no disconnected hidden neurons
  5. Memetic inherited from mother (Europa mother with memetic)
  6. Memetic fallback from father (GRQ-25-1 mother without memetic)
  7. Memetic data references valid neurons after breeding
  8. Asymmetric neuron counts: many-neuron father, few-neuron mother
  9. Asymmetric neuron counts: few-neuron father, many-neuron mother
  10. Multiple consecutive breedings produce valid, varied offspring without state corruption
  11. Multiple consecutive breedings in reverse direction
