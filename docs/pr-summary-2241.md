## Summary

Improve fitness evaluation throughput when workers are running long tasks
(discovery/training). Closes #2241.

When all workers are occupied with long-running tasks, the fitness evaluator now
waits briefly (configurable via `busyWorkerWaitMs`, default 5 seconds) for a
worker to become free before falling back to the full pool. This prevents
`Promise.all` from stalling on workers mid-discovery/training.

Additionally, worker availability is now logged at `info` level with the ratio
format (e.g., "Fitness: using 3/8 workers, 5 running long tasks") so the impact
is visible during evolution runs.

### Changes

- **`src/config/ParallelEvaluationConfig.ts`**: Added `busyWorkerWaitMs` config
  option (default 5000ms) to control the bounded wait duration.
- **`src/architecture/Fitness.ts`**: Implemented bounded wait polling when all
  workers are busy; upgraded logging from debug to info level with worker
  availability ratio.
- **`src/config/NeatConfigParsers.ts`**: Added parsing for `busyWorkerWaitMs` in
  `parseParallelEvaluation()`.

### Test modifications

Existing tests in `FitnessExcludeBusyWorkers.ts`, `BatchCreatureEvaluation.ts`,
`FitnessTopologyGrouping.ts`, and `bench/ParallelEvaluation.ts` were updated to
explicitly set `busyWorkerWaitMs: 0` where they construct
`RequiredParallelEvaluationConfig` objects directly. This keeps them fast by
bypassing the bounded wait, which is unrelated to what those tests verify. No
existing tests were removed or commented out.

## Evidence

All 5689 tests pass, including the 4 new tests and all existing tests.

## Test Plan

- `test/architecture/FitnessBusyWorkerWait.ts` (4 new tests):
  - **Bounded wait uses worker that becomes free during wait**: verifies that
    when a worker finishes its long task mid-wait, only that worker is used.
  - **Bounded wait falls back after timeout**: verifies fallback to all workers
    when none becomes free within the timeout.
  - **Bounded wait disabled when busyWorkerWaitMs is zero**: verifies immediate
    fallback when the wait is disabled.
  - **Logs worker availability ratio at info level**: verifies the info-level
    log message is emitted with worker availability details.
