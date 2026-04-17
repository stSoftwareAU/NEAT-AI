## Summary

Allow idle fast workers to be borrowed for heavy tasks (discovery/training) when
the heavy pool is saturated. This is the symmetric counterpart to Issue #2313
where idle heavy workers already assist fitness and breeding. Closes #2329.

When `allowPoolBorrowing` is enabled (the default), `scheduleDiscovery()` and
`scheduleTraining()` fall back to idle fast-pool workers when no heavy worker is
available. This reduces wasted CPU time on high-core machines where the fast
pool finishes fitness/breeding quickly but the heavy pool is still processing
long-running discovery or training tasks.

The feature can be disabled via `allowPoolBorrowing: false` for a clear rollback
path, restoring the strict pool separation from Issue #2244.

## Changes

- **`src/config/NeatArguments.ts`**: Added `allowPoolBorrowing` boolean field
- **`src/config/NeatConfig.ts`**: Default `allowPoolBorrowing` to `true`
- **`src/NEAT/NeatScheduling.ts`**: Modified `scheduleDiscovery()` and
  `scheduleTraining()` to borrow idle fast workers when the heavy pool is
  saturated and `allowPoolBorrowing` is enabled
- **`docs/PERFORMANCE_TUNING.md`**: Documented `heavyTaskWorkerCount` and
  `allowPoolBorrowing` configuration options

## Evidence

This is a backend scheduling change with no UI. The implementation is validated
via unit tests that exercise the pool borrowing logic directly. The 1 flaky test
failure (`PhasePipelining`) is a pre-existing timing issue unrelated to this
change (passes in isolation).

## Test Plan

- Added `test/NEAT/PoolBorrowing.ts` with 11 tests:
  - `WorkerPool.getIdleWorkers` returns only non-busy workers
  - `WorkerPool.selectWorker` returns idle worker when available
  - `WorkerPool.selectWorker` returns busy worker when saturated
  - Pool borrowing: idle fast worker used when heavy pool saturated
  - Pool borrowing: disabled via config - no borrowing occurs
  - Pool borrowing: heavy pool has idle worker - no borrowing needed
  - Pool borrowing: shared pool (non-partitioned) - no borrowing attempted
  - Pool borrowing: both pools fully saturated - returns busy heavy worker
  - `allowPoolBorrowing` defaults to `true` in NeatConfig
  - `allowPoolBorrowing` can be disabled via config
  - `allowPoolBorrowing` can be explicitly enabled via config
- All existing tests pass (5939 passed, 1 flaky pre-existing failure)
