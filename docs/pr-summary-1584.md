## Summary

Remove four redundant `creature.validate()` calls from `AddConnection.mutate()`.
These calls duplicated the validation already performed by `Mutator.repairAfterMutation()`
after the full mutation batch (introduced in #1583). This eliminates unnecessary topology
cache rebuilds and graph traversal during forward-only mutation. Closes #1584.

## Evidence

### Benchmark Results (Apple M4 Pro, Deno 2.6.8)

| Benchmark | Before | After | Improvement |
|---|---|---|---|
| Sparse (5 in, 5 hidden, 3 out) | 128.9 µs | 114.5 µs | **11.2% faster** |
| Medium (10 in, 15 hidden, 5 out) | 617.0 µs | 555.9 µs | **9.9% faster** |
| Large (20 in, 30 hidden, 10 out) | 2.4 ms | 2.2 ms | **8.3% faster** |

Consistent improvement across all creature sizes. The gains come from removing
redundant `validate({ forwardOnly: true })` calls that rebuild the topology cache.

### Changes Made

- **`src/mutate/AddConnection.ts`**: Removed pre-mutation validate/fix/validate block
  and post-mutation validate/fix/validate block. Kept the neuron index consistency
  assertion (data integrity check, not validation). Removed unused `getMajorVersion`
  import and `bumpToFourIfForwardOnlyConfirmed` helper.
- **Tests updated**: `AddConnectionForwardOnlyRepair.ts` and
  `MutatorRepairsForwardOnlyFourXCorruption.ts` updated to test validation through
  `Mutator.repairAfterMutation()` instead of through AddConnection's internal
  (now removed) validate calls.

## Test Plan

- Added `test/mutate/AddConnectionNoRedundantValidation.ts` with 4 tests:
  - Forward-only creature adds only forward connections (without internal validation)
  - Full mutation batch produces valid forward-only creatures via Mutator
  - Standalone AddConnection call still produces valid creatures
  - Memetic flag cleared correctly without internal validation
- Updated `test/mutate/AddConnectionForwardOnlyRepair.ts` (2 tests):
  - Pre-4.x forward-only repair now tested through Mutator.repairAfterMutation()
  - 4.x forward-only repair now tested through Mutator.repairAfterMutation()
- Updated `test/mutate/MutatorRepairsForwardOnlyFourXCorruption.ts` (1 test updated):
  - Verifies Mutator.repairAfterMutation() removes recurrent synapses from 4.x creatures
- Added `bench/mutate/AddConnectionValidation.ts` for benchmarking
- All 4353 existing tests pass
