## Summary

Add unit tests for `Breed.ts` core orchestration and `EditParentByIndex.ts` parent editing logic. Closes #1485.

Two important modules in `src/breed/` lacked dedicated test coverage:
- **`Breed.ts`** - The core breeding orchestration that coordinates parent selection, crossover, and offspring generation via the `Genus` population.
- **`EditParentByIndex.ts`** - Parent editing by index for targeted crossover operations (grafting).

## Evidence

This is a testing-only change with no UI or performance modifications. All 21 new tests pass:

**Breed.ts orchestration tests (10 tests):**
- Compatible parents produce valid offspring
- Offspring is structurally valid (round-trip export/import)
- Single creature population returns undefined (no father available)
- Creatures with no hidden neurons can breed without errors
- Structurally different parents produce valid offspring
- Offspring has synapses
- Repeated breeding produces diverse offspring
- Works with POWER, FITNESS_PROPORTIONATE, and TOURNAMENT selection strategies
- Offspring UUID differs from all parents

**EditParentByIndex.ts tests (11 tests):**
- Non-matching hidden neurons are remapped to parent UUIDs
- Produces a valid creature
- Does not modify original parent (no side effects)
- Does not modify original target (no side effects)
- Matching hidden neurons are preserved
- Grafting tags (alias, approach) are applied to remapped neurons
- Synapses are updated after UUID remapping
- Creatures with no hidden neurons return valid child
- Multiple hidden neurons are remapped sequentially
- Partial overlap preserves matching, remaps non-matching
- Works with multi-output creatures

## Test Plan

- Added `test/breed/Breed.ts` with 10 tests for Breed class orchestration
- Added `test/breed/EditParentByIndex.ts` with 11 tests for parent editing by index
- All tests use `Deno.test()` with `@std/assert`, following existing patterns in `test/breed/BreedBehavioural.ts` and `test/breed/ParentSelection.ts`
- Tests exercise real breeding logic with actual creature structures
- Quality checks pass (lint, format, type-check)
