## Summary

Implements a work-stealing queue pattern for better load distribution across
workers, replacing the random selection with fallback to least-busy approach.

### Changes

- **New file: `src/multithreading/WorkStealingQueue.ts`** - A concurrent deque
  (double-ended queue) implementation enabling work-stealing patterns. Workers
  push/pop from front while thieves steal from back.

- **New file: `src/multithreading/WorkerPool.ts`** - Worker pool manager with
  work-stealing capabilities, including:
  - Intelligent worker selection based on queue size
  - Workload-based selection using estimated task durations
  - Bulk steal operations for efficient load rebalancing
  - Statistics tracking for monitoring load balancing effectiveness

- **Modified: `src/NEAT/Neat.ts`** - Integrated `WorkerPool` for smarter worker
  selection in `scheduleDiscovery()` and `scheduleTraining()` methods, replacing
  the previous random + linear scan approach.

### Key Features

1. **Work-stealing queues per worker** - Each worker maintains a local deque of
   tasks
2. **Smarter worker selection** - Selects non-busy workers first, falls back to
   least-loaded when all busy
3. **Workload-aware selection** - Can select workers based on estimated task
   duration
4. **Steal operations** - Idle workers can steal tasks from busy workers' queues
5. **Statistics tracking** - Tracks steal attempts and success rates for
   monitoring

## Evidence

### Benchmark Results

```
CPU | Apple M4 Pro
Runtime | Deno 2.6.7

group Worker Selection (idle)
| Old: Random selection (all workers idle)    |  43.9 µs | 22,750 iter/s |
| New: WorkerPool.selectWorker (all idle)     |  10.4 µs | 96,440 iter/s |

summary: New approach is 4.24x faster for idle worker selection

group Worker Selection (busy)
| Old: Random + linear scan (all workers busy)|  116.2 µs |  8,605 iter/s |
| New: WorkerPool.selectWorker (all busy)     |  403.1 µs |  2,481 iter/s |

summary: Old approach is 3.47x faster when all workers are busy
         (expected - new approach checks queue sizes)

group Queue Operations
| WorkStealingQueue: pushBack + popFront             | 177.7 µs |
| WorkStealingQueue: mixed pushBack/popFront/popBack |  87.1 µs |

group Steal Operations
| WorkStealingQueue: stealHalf from 1000 items | 3.6 µs | 280,600 iter/s |
| WorkerPool: stealWork simulation             | 9.2 µs | 108,200 iter/s |
```

**Analysis**: The new approach shows significant improvement (4.24x faster) for
the common case of selecting idle workers. The overhead when all workers are
busy is acceptable given the load balancing benefits. The real-world improvement
comes from:

- Reduced worker idle time through work stealing
- Better handling of heterogeneous task durations
- More even load distribution across workers

## Test Plan

### New Tests Added

- **`test/multithreading/WorkStealingQueue.ts`** (21 tests):
  - Queue operations: pushBack, popFront, popBack
  - Edge cases: empty queue, single item
  - Ordering: FIFO for owner, steal from back
  - Utility: clear, peek, peekBack, toArray
  - Workload estimation: getEstimatedWorkload
  - Bulk steal: stealHalf

- **`test/multithreading/WorkerPool.ts`** (19 tests):
  - Worker selection: non-busy preferred, smallest queue when all busy
  - Queue management: queueTask, dequeueTask, clearQueue
  - Work stealing: stealWork, findBusiestWorker
  - Statistics: getStats, stealAttempts, successRate
  - Load balancing: even distribution when all busy
  - Workload-based selection: selectWorkerByWorkload

### Existing Tests

All 1863 existing tests continue to pass, confirming the integration doesn't
break existing functionality.

## References

- Closes #1290
- Parent: #1288 (Performance improvements)
- Related: #1026 (Parallel breeding)
