## Summary

Replaced the recursive `processNext` function in
`ParallelBreeding.breedWithWorkers` with an iterative `while` loop. The
recursive approach called `await processNext(worker)` at the end of each task
completion, which could lead to stack overflow or high memory usage for large
populations. The iterative approach uses `while (queue.length > 0)` with
`queue.shift()` to distribute tasks to workers without recursion. Closes #1585.

## Evidence

This is a backend correctness/safety fix with no UI changes. The change was
validated by:

1. **New tests** exercising the worker breeding path with mock workers,
   including a large-batch test (500 offspring) that would risk stack overflow
   with the recursive approach.
2. **Benchmarks** confirming no performance regression:

**Before (recursive):**

| Benchmark                  | time/iter (avg) |
| -------------------------- | --------------- |
| Sequential (40 offspring)  | 18.8 ms         |
| Parallel (40 offspring)    | 18.3 ms         |
| Sequential (100 offspring) | 45.1 ms         |
| Parallel (100 offspring)   | 44.7 ms         |

**After (iterative while loop):**

| Benchmark                  | time/iter (avg) |
| -------------------------- | --------------- |
| Sequential (40 offspring)  | 17.5 ms         |
| Parallel (40 offspring)    | 17.4 ms         |
| Sequential (100 offspring) | 42.1 ms         |
| Parallel (100 offspring)   | 42.0 ms         |

Performance is equivalent (within measurement noise). The primary benefit is
correctness — avoiding stack overflow for large populations.

3. **All 4356 tests pass** after the change.

## Test Plan

- Added `ParallelBreeding - worker path produces valid offspring`: Verifies mock
  workers produce valid offspring through the worker breeding path.
- Added
  `ParallelBreeding - worker path handles large batch without stack overflow`:
  Breeds 500 offspring with 2 workers to verify no stack overflow.
- Added `ParallelBreeding - worker path distributes work across all workers`:
  Verifies all workers receive tasks from the shared queue.
