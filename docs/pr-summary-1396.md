## Summary

Extract a shared `AbstractMutationOperator` base class for the 12 mutation operators in `src/mutate/`, eliminating duplicated constructor boilerplate, interface implementation, and neuron selection patterns. Closes #1396.

### Changes

- **New `AbstractMutationOperator` base class** (`src/mutate/AbstractMutationOperator.ts`):
  - Stores the shared `creature` reference (was duplicated in every operator)
  - Implements `RadioactiveInterface.mutate()` delegating to `performMutation()`
  - Provides `selectRandomHiddenNeuronIndex()` — shared retry-with-focus-relaxation pattern (used by SwapNeurons, available to future operators)
  - Provides `selectRandomNonInputNeuronIndex()` — shared pattern (used by ModBias, ModActivation)

- **Refactored all 12 mutation operators** to extend `AbstractMutationOperator`:
  - `ModBias`, `ModActivation` (ModSquash): Reduced from ~33 lines to ~12 lines each by using `selectRandomNonInputNeuronIndex()`
  - `SwapNeurons`: Reduced from ~95 lines to ~60 lines by using `selectRandomHiddenNeuronIndex()`
  - `AddSelfCon`, `AddBackCon`, `SubSelfCon`, `SubBackCon`, `SubConnection`, `SubNeuron`: Removed boilerplate constructor and interface import
  - `AddConnection`, `AddNeuron`: Extended base class while preserving their specialised mutation logic
  - `ModWeight`: Extended base class while preserving its custom constructor (extra config parameter)

- **Simplified `Mutator.ts` caching**:
  - Consolidated 12 separate `WeakMap` caches into a single `WeakMap<Creature, Map<string, RadioactiveInterface>>`
  - Extracted `createOperator()` factory method from the repetitive switch statement
  - Reduced `getMutatorInstance()` from ~100 lines to ~20 lines

### Metrics

- **190 lines removed** (344 deletions, 154 additions including new base class and tests)
- **11 fewer `RadioactiveInterface` imports** (consolidated into base class)
- **11 fewer `WeakMap` declarations** (consolidated into single cache)

## Evidence

This is a pure refactoring change (backend/CLI, no UI). All 2,592 existing tests continue to pass, confirming behavioural equivalence.

## Test Plan

- Added `test/mutate/AbstractMutationOperator.ts` with 8 tests covering:
  - Base class stores creature reference correctly
  - `mutate()` delegates to `performMutation()`
  - `selectRandomHiddenNeuronIndex()` returns valid indices, respects focus lists, returns -1 for no hidden neurons
  - `selectRandomNonInputNeuronIndex()` returns valid indices, skips constant neurons
- All 2,592 existing tests pass unchanged (verified via `quality.sh`)
