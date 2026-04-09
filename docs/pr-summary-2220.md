## Summary

Replace the 12-case switch statement in `Mutator.createOperator()` with a static
`Map`-based factory lookup. This improves adherence to the Open/Closed Principle —
adding a new mutation type now requires only a single map entry instead of modifying
the switch. Closes #2220.

## Changes

- **`src/NEAT/Mutator.ts`**: Added `private static readonly operatorFactories` map
  containing all 12 mutation operator factory functions. Replaced the switch-based
  `createOperator()` with a map lookup that throws `ValidationError` for unknown
  methods.
- **`test/NEAT/MutatorMutateCreature.ts`**: Updated error message assertion to
  match the capitalised "Unknown mutation method" format.
- **`test/NEAT/MutatorOperatorFactory.ts`**: New test file verifying all operators
  instantiate correctly via the factory map, unknown methods throw `ValidationError`,
  and caching behaviour is preserved.

## Evidence

All 98 existing Mutator tests pass unchanged (except the error message casing fix).
No behavioural change — the factory map produces identical operator instances.

## Test Plan

- `test/NEAT/MutatorOperatorFactory.ts` — 5 new tests:
  - All FFW operators instantiate via factory
  - All ALL operators (including recurrent) instantiate via factory
  - Unknown method throws `ValidationError`
  - Cached instances are reused for same creature
  - Different creatures get different instances
- All existing `test/NEAT/Mutator*.ts` and `test/mutate/Mutator*.ts` tests pass
