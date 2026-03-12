## Summary

Decomposed `src/compact/CompactUtils.ts` (618 lines, 4 responsibilities) into
focused single-responsibility modules, following the project's established
modularisation pattern. Closes #1745.

### New modules:

- **`OrphanedNeuronCleanup.ts`** — `createConstantOne()`,
  `removeHiddenNeuron()`, `cleanupOrphanedNeurons()`,
  `cleanupOrphanedNeuronsInCreature()`
- **`SynapsePruning.ts`** — `mergeDuplicateSynapses()`,
  `pruneZeroWeightSynapses()`
- **`DeadSubgraphPruning.ts`** — `pruneDeadSubgraphs()`,
  `pruneDeadSubgraphsInCreature()`
- **`MemeticCleanup.ts`** — `cleanupMemeticForRemovedSynapse()`,
  `cleanupMemeticForRemovedNeuron()`

`CompactUtils.ts` is now a thin re-export barrel file maintaining full backward
compatibility — no callers need updating.

This is a pure refactoring with no functional changes.

## Evidence

- All 4690 existing tests pass without modification
- `./quality.sh` passes cleanly (format, lint, type-check, tests)

## Test Plan

- Added `test/Compact/OrphanedNeuronCleanup.ts` — 3 tests for direct imports
  from the new module
- Added `test/Compact/SynapsePruning.ts` — 2 tests for direct imports from the
  new module
- Added `test/Compact/DeadSubgraphPruningModule.ts` — 2 tests for direct imports
  from the new module
- Added `test/Compact/MemeticCleanup.ts` — 4 tests for direct imports from the
  new module
- All existing tests in `test/Compact/CompactUtils.ts` continue to pass via
  re-exports
