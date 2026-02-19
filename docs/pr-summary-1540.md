## Summary

Reduce per-iteration allocations in the training loop by eliminating unnecessary
object creation in the hot path. Closes #1540.

Three optimisations applied to `src/architecture/Training.ts`:

1. **Mutable iteration config**: Instead of calling
   `createBackPropagationConfig()` with spread+freeze every iteration, a mutable
   `BackPropagationArguments` copy is created once before the loop and its
   `generations` and `learningRate` fields are updated in place each iteration.
   Benchmark shows **10.9x faster** config updates.

2. **Scratch Int32Array reuse**: The temporary `Int32Array` used for index
   shuffling is now allocated once and reused across files (growing only when a
   larger file is encountered), avoiding per-file allocations. A `subarray()`
   view is used for the exact file size.

3. **SparseConfig skip guard**: Already effectively implemented via the
   `sparseRatio < 1` check before `collectNeuronErrors()` and the
   `neuronErrors && neuronErrors.size > 0` guard before rebuild. Added
   clarifying comment documenting the skip behaviour.

## Evidence

Benchmark results (Apple M4 Pro, Deno 2.6.10):

```
group config-allocation
| Frozen config copy per iteration (100 iters)    |   6.7 µs |   149,900 iter/s |
| Mutable config update per iteration (100 iters) | 610.1 ns | 1,639,000 iter/s |
  -> Frozen copy is 10.93x slower than mutable update

group index-allocation
| Fresh Int32Array per file (10 files, 5000 recs)  | 2.6 ms | 381.8 iter/s |
| Reused scratch Int32Array (10 files, 5000 recs)  | 2.5 ms | 397.0 iter/s |
  -> Fresh allocation is 1.04x slower (marginal, dominated by shuffle cost)
```

This is a purely backend/internal change with no visual output.

## Test Plan

- Added `test/TrainingLoopAllocations.ts` with 5 tests:
  - Mutable iteration config produces valid training results across multiple
    iterations
  - Scratch index buffer reuse works with multiple binary files
  - SparseConfig skips rebuild when sparseRatio is 1
  - Training with sparse ratio < 1 still rebuilds SparseConfig when needed
  - Training error decreases or stays finite over multiple iterations
- All 4172 existing tests continue to pass
- Added `bench/TrainingLoopAllocations.ts` benchmark
