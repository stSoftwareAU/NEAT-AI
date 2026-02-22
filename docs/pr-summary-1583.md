## Summary

Optimise the mutation loop by batching `fix()` and `validate()` calls. Previously, `Mutator.mutateCreature()` called `creature.fix()` and `creature.validate()` after every single atomic mutation. When `mutationAmount > 1`, this caused redundant topology cache rebuilds and graph traversal. Closes #1583.

### Changes

1. **Extracted `repairAfterMutation(creature)`** from `mutateCreature()` into a new public method on `Mutator`. This method runs `fix()` (with `forwardOnly` when applicable) and forward-only validation/repair.

2. **`mutateCreature()` no longer calls `fix()` or `validate()`** — it applies the raw mutation and returns a `changed` boolean. Callers must call `repairAfterMutation()` themselves after one or more mutations.

3. **`mutate()` calls `repairAfterMutation()` once** after the entire mutation loop (if any mutation occurred), rather than per-mutation.

4. **Forward-only repair improved** — `repairAfterMutation()` calls `fix({ forwardOnly: true })` for forward-only creatures, which removes self/back connections in a single pass before validation.

## Evidence

### Benchmark Results (Apple M4 Pro)

| Benchmark | Baseline | Optimised | Speedup |
|---|---|---|---|
| 50 creatures, mutationAmount=3 | 24.5 ms | 16.5 ms | **33% faster** |
| 50 creatures, mutationAmount=5 | 33.9 ms | 20.6 ms | **39% faster** |
| 50 creatures, mutationAmount=10 | 61.6 ms | 31.7 ms | **49% faster** |
| 20 large creatures, mutationAmount=5 | 91.2 ms | 52.3 ms | **43% faster** |
| 20 large creatures, mutationAmount=10 | 162.9 ms | 80.3 ms | **51% faster** |

The improvement scales with `mutationAmount` — higher values benefit more from batching, as expected.

## Test Plan

- Added `test/NEAT/MutatorBatchRepair.ts` with 7 new tests:
  - `repairAfterMutation` produces valid creatures after ADD_NODE and SUB_NODE
  - Multiple mutations with single repair produces valid creatures
  - `mutate()` with `mutationAmount=10` produces valid creatures
  - Forward-only constraint preserved with batched repair
  - 4.x forward-only enforced with batched repair
  - `mutateCreature` return value still correct
- Updated existing tests to call `repairAfterMutation()` after `mutateCreature()`
- Added `bench/MutationLoopBatchRepair.ts` benchmark
- All 4349 tests pass
