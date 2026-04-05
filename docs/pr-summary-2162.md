## Summary

Exclude workers running long-running tasks (discovery/training) from the fitness
evaluation pool in `Fitness.calculate()`. When a worker has an active long task,
`Promise.all` would stall waiting for it while other workers sat idle. Now only
available workers participate, and work-stealing distributes all creatures among
them. If all workers are busy, falls back to using all workers to avoid deadlock.

Closes #2162

## Changes

- **`src/architecture/Fitness.ts`**: Filter `activeWorkers` via
  `isRunningLongTask()` before `Promise.all`. Guard ensures at least one worker
  always participates. Debug logging when workers are excluded.
- **`test/architecture/FitnessExcludeBusyWorkers.ts`**: New test suite with 5
  tests covering: busy worker exclusion, all-busy fallback, normal operation,
  and single-worker configurations.
- **Existing test mocks updated**: Added `isRunningLongTask()` to mock workers
  in `FitnessTopologyGrouping.ts`, `FitnessTypedErrors.ts`,
  `BatchCreatureEvaluation.ts`, `ParallelFitnessEvaluation.ts`,
  `FitnessDeduplication.ts`, and `FitnessQueueDequeue.ts`.

## Evidence

All 5279 tests pass, including the 5 new tests for this feature.

## Test Plan

- `test/architecture/FitnessExcludeBusyWorkers.ts`:
  - Workers with active long tasks are excluded from evaluation
  - Falls back to all workers when every worker is busy (no deadlock)
  - All workers used normally when none are running long tasks
  - Single busy worker still evaluates (fallback)
  - Single available worker evaluates normally
