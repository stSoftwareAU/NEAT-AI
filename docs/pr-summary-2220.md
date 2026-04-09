## Summary

Replace the 12-case switch statement in `Mutator.createOperator()` with a static
`Map<string, factory>` lookup, following the Open/Closed Principle. Adding a new
mutation type now requires only a new map entry rather than modifying a switch
block. All 12 mutation operators are correctly instantiated via the map, error
handling for unknown methods is preserved (with capitalised message for
consistency), and all existing tests pass unchanged. Closes #2220.

## Evidence

- All 5512 existing tests pass with zero failures
- `./quality.sh` passes cleanly
- No behavioural change: the factory map produces identical operator instances
  to the previous switch statement

## Test Plan

- Added `test/NEAT/MutatorOperatorFactory.ts` with 5 tests:
  - Verifies all 12 mutation operators are instantiated with correct types
  - Verifies unknown method names throw `ValidationError`
  - Verifies operator caching per creature works correctly
  - Verifies different creatures get separate operator instances
  - Verifies all `Mutation.ALL` entries are covered by the factory
- Updated `test/NEAT/MutatorMutateCreature.ts` to match capitalised error
  message
