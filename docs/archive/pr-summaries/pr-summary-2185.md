## Summary

Add integration tests for the complete inter-species breeding pipeline using
real-world GRQ-25-1 and Europa sample creature fixtures. These creatures have
worst-case genetic incompatibility (zero shared hidden neuron UUIDs), exercising
every inter-species breeding code path with representative data. Closes #2185.

## Evidence

All 11 new tests pass alongside the full test suite (5341 tests, 0 failures):

- Genetic compatibility verified as 0 for the GRQ-25-1/Europa pair
- Both creatures produce valid UUIDs via `CreatureUtil.makeUUID()`
- `editParentByIndex()` produces valid mapped fathers in both directions
- `Offspring.breed()` produces valid offspring in both directions
- `inputWeightCrossover()` preserves mother's topology in both directions
- `subgraphTransplant()` adds tagged neurons and increases hidden neuron count
  in both directions
- All offspring pass `creatureValidate()`

## Test Plan

- Added `test/breed/InterSpeciesBreeding.ts` with 11 integration tests covering:
  - Genetic compatibility verification (1 test)
  - UUID validity for both fixtures (1 test)
  - `editParentByIndex` neuron alignment in both directions (2 tests)
  - Full `Offspring.breed` pipeline in both directions (2 tests)
  - `inputWeightCrossover` in both directions (2 tests)
  - `subgraphTransplant` with tag and neuron count verification in both
    directions (2 tests)
  - Combined bidirectional breeding validation (1 test)
