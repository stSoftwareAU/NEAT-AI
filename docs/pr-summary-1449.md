## Summary

Investigated using a min-heap for O(log n) least-loaded worker selection in
`WorkerPool.ts`, replacing the O(n) linear scan in `findLeastLoadedWorker()`.
Closes #1449.

**Negative result**: Benchmarks show the linear scan is consistently faster than
the heap-based approach at all tested pool sizes (4–128 workers). The
implementation was not merged; only the benchmark is included as evidence.

## Evidence

### Why the heap approach is slower

While `peekMin()` is O(1) vs O(n) for the linear scan, every `queueTask()` and
`dequeueTask()` requires an O(log n) `updateLoad()` call to maintain the heap.
Since queue sizes change on every task assignment/completion, the cumulative
heap maintenance overhead far exceeds the savings from faster min lookups.

The linear scan benefits from cache-friendly sequential array access, which
modern CPUs optimise very effectively for small arrays.

### Benchmark results (Apple M4 Pro, Deno 2.6.9)

#### Realistic workload (interleaved assign + select, 10,000 iterations)

| Workers | Linear scan | Heap-based | Result             |
| ------- | ----------- | ---------- | ------------------ |
| 8       | 46.3 µs     | 351.1 µs   | Linear 7.6x faster |
| 32      | 142.8 µs    | 682.8 µs   | Linear 4.8x faster |
| 128     | 633.3 µs    | 1,420 µs   | Linear 2.2x faster |

Even at 128 workers (far beyond typical pool sizes of 4–16), the linear scan
wins.

#### Pure selection only (no queue changes)

| Workers | Linear scan | Heap peekMin | Result           |
| ------- | ----------- | ------------ | ---------------- |
| 4       | 45.7 µs     | 4.7 µs       | Heap 9.7x faster |
| 128     | 1,100 µs    | 5.1 µs       | Heap 220x faster |

The heap wins for pure selection, but this is not the real workload — queue
sizes change on every operation.

### Conclusion

The heap approach trades O(n) selection for O(log n) maintenance on every queue
mutation. For worker pools of any practical size, the overhead of heap
maintenance exceeds the benefit. The existing linear scan is the better choice.

## Test Plan

- No source code changes to test — implementation was reverted after negative
  benchmark result
- Added `bench/HeapWorkerSelection.ts` as a self-contained benchmark comparing
  both approaches
- All existing 3,599 tests continue to pass
- Run benchmark with: `deno bench bench/HeapWorkerSelection.ts`
