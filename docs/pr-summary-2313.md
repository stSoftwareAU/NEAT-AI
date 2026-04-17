## Summary

Implement dynamic worker pool membership so idle heavy workers can temporarily
assist fitness evaluation and breeding phases. When heavy workers have no
pending discovery or training tasks, they are borrowed by the fast pool for the
duration of fitness evaluation and breeding, then naturally returned before any
heavy task is scheduled. Closes #2313.

## Changes

- **`WorkerPool.getIdleWorkers()`**: New method returning workers that are not
  busy and have no queued tasks, used to identify heavy workers available for
  temporary loan.
- **`Fitness.calculate()` — `additionalWorkers` parameter**: Accepts extra
  workers (idle heavy-pool) to combine with the dedicated fast-pool workers for
  a single evaluation pass.
- **`NeatEvolution.evolve()`**: Before fitness evaluation and breeding, queries
  the heavy pool for idle workers and passes them as additional capacity.
  Verbose logging reports when heavy workers are borrowed.
- **Benchmark**: 200-creature population, 8 fast + 2 idle heavy workers vs 8
  fast only → **1.44× faster** (44% improvement in fitness evaluation
  throughput).

## Evidence — Benchmark Results

```
group dynamic-pool
| Fitness evaluation — 8 fast workers only (baseline)     |  109.1 ms |   9.2/s |
| Fitness evaluation �� 8 fast + 2 idle heavy workers      |   75.9 ms |  13.2/s |

summary
  Baseline is 1.44x slower than dynamic pooling
```

No race conditions: heavy tasks (discovery/training) are scheduled in the
evolution loop AFTER fitness and breeding complete, so borrowed heavy workers
are naturally returned before any heavy task begins.

## Test Plan

- `test/multithreading/WorkerPool.ts` — 3 new tests for `getIdleWorkers()`:
  - Returns only workers that are not busy AND have empty queues
  - Returns empty array when all workers are busy
  - Returns all workers when all are idle
- `test/architecture/FitnessDynamicPool.ts` — 4 new tests:
  - Additional workers participate in evaluation alongside fast-pool workers
  - Normal operation when no additional workers provided
  - Normal operation with empty additional workers array
  - `maxConcurrentEvaluations` cap respected with combined worker list
- All 33 related tests pass, all existing tests unmodified
