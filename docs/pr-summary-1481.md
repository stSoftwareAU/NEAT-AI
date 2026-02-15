## Summary

Replace `Array.shift()` with an O(1) index-pointer dequeue in the work-stealing
queue within `Fitness.calculate()`. `Array.shift()` is O(n) per call because it
re-indexes all remaining elements, creating O(n²) total overhead for large
populations. The index-pointer approach (`queue[front++]`) is O(1) per dequeue,
reducing total overhead to O(n). Closes #1481.

## Evidence

Benchmark results (`deno bench bench/FitnessQueueDequeue.ts`):

| Population size | Array.shift() | Index pointer | Speedup |
|-----------------|---------------|---------------|---------|
| 100 items       | 1.1 µs        | 178.2 ns      | 6.45x   |
| 1,000 items     | 16.4 µs       | 2.2 µs        | 7.44x   |
| 10,000 items    | 163.3 µs      | 21.4 µs       | 7.65x   |
| 100,000 items   | 611.1 ms      | 273.1 µs      | 2,237x  |

The improvement grows superlinearly with population size due to the O(n²) vs
O(n) algorithmic difference.

## Test Plan

- Added `test/FitnessQueueDequeue.ts` with three tests:
  - All unique creatures evaluated correctly with multiple workers
  - Empty population handled correctly
  - Single creature with multiple workers
- All existing tests pass (3,638 tests, 0 failures)
- Added `bench/FitnessQueueDequeue.ts` benchmark comparing shift vs index-pointer
