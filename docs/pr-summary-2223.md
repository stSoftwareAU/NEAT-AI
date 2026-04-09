## Summary

Extract `computeNeuronDependencyIndex()` helper from `Offspring.sortNeurons()`
to reduce nesting depth from 8+ levels to 4. The new function encapsulates the
synapse iteration logic that determines a neuron's dependency-aware sort index.
No behavioural change — all existing breeding/offspring tests pass. Closes
#2223.

## Evidence

- `./quality.sh` passes cleanly: 5684 tests passed, 0 failed
- Existing `OffspringSortNeurons.ts` test continues to pass unchanged
- New `ComputeNeuronDependencyIndex.ts` tests verify the extracted function in
  isolation

## Test Plan

- Added `test/breed/ComputeNeuronDependencyIndex.ts` with 5 tests covering:
  - Returns base index when no connections exist
  - Returns base index when all source neurons are inputs
  - Bumps index when a dependency has a higher index
  - Returns -1 when a non-input dependency is unresolved
  - Keeps base index when dependency index is lower
- All existing breeding tests pass without modification
