## Summary

Route fitness evaluation through fast-pool workers instead of reactively
filtering out busy workers. Closes #2245.

Fitness evaluation previously received all workers and dynamically excluded
those running long tasks (discovery/training) via `isRunningLongTask()`. This
was fragile — when all workers were busy, it fell back to using the full pool,
which could stall `Promise.all`.

With this change, `Fitness` only receives workers from a dedicated fast pool
that never run discovery or training. The reactive filtering, bounded wait
polling, and all-workers-busy fallback are eliminated entirely.

### Changes

- **`src/architecture/Fitness.ts`**: Removed `isRunningLongTask()` filtering,
  `awaitAvailableWorkers()` polling method, busy-worker fallback logic, and
  `POLL_INTERVAL_MS` constant. Fitness now uses its workers directly.
- **`src/config/ParallelEvaluationConfig.ts`**: Removed `busyWorkerWaitMs`
  config option (no longer needed).
- **`src/config/NeatConfigParsers.ts`**: Removed `busyWorkerWaitMs` parsing.
- **`src/NEAT/Neat.ts`**: Added optional `fastWorkers` parameter to constructor.
  When provided, fast-pool workers are passed to `Fitness` instead of all
  workers.
- **`src/creature/CreatureTraining.ts`**: Partitions workers into fast and heavy
  pools when 3+ workers are available (reserves 1 for heavy tasks, rest for
  evaluation).

### Test modifications

**Business logic change**: The `isRunningLongTask()` filtering in Fitness has
been replaced by a structural fix (fast-pool architecture). Tests that verified
the old reactive filtering behaviour have been updated to verify the new
fast-pool behaviour:

- **`test/architecture/FitnessExcludeBusyWorkers.ts`**: Rewritten to verify
  fast-pool workers evaluate all creatures without filtering.
- **`test/architecture/FitnessBusyWorkerWait.ts`**: Rewritten to verify
  fast-pool evaluation without bounded wait polling.
- **`test/architecture/FitnessFastPoolEvaluation.ts`**: New test verifying
  evaluation completes promptly even when heavy-pool workers are occupied, and
  that workers without `isRunningLongTask()` work correctly.
- Removed dead `isRunningLongTask()` mock methods from:
  `FitnessTopologyGrouping.ts`, `BatchCreatureEvaluation.ts`,
  `ParallelFitnessEvaluation.ts`, `FitnessDeduplication.ts`,
  `FitnessQueueDequeue.ts`, `FitnessWasmPanicRecovery.ts`,
  `FitnessTypedErrors.ts`.
- Removed `busyWorkerWaitMs` from all test config objects.

## Evidence

All 5698 tests pass (0 failed, 3 ignored) after changes.

## Test Plan

- `test/architecture/FitnessFastPoolEvaluation.ts` — new test verifying:
  - Fast-pool workers evaluate all creatures without filtering
  - Evaluation completes promptly when heavy-pool workers are occupied elsewhere
  - Workers without `isRunningLongTask()` work correctly (method no longer
    called)
- `test/architecture/FitnessExcludeBusyWorkers.ts` — updated to verify fast-pool
  behaviour
- `test/architecture/FitnessBusyWorkerWait.ts` — updated to verify fast-pool
  behaviour
- All existing fitness evaluation tests continue to pass
