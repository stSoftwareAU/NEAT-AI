## Summary

Add long-running task tracking to `WorkerHandlerBase` so callers can distinguish
workers occupied with long-running operations (discover, train) from those doing
quick evaluations. This enables smarter work routing in `Fitness.calculate()`.

- Added `longRunningTaskCount` field and `isRunningLongTask()` method to
  `WorkerHandlerBase`
- Added protected `incrementLongRunningTaskCount()` /
  `decrementLongRunningTaskCount()` helpers for subclasses
- Wrapped `WorkerHandler.discover()` and `WorkerHandler.train()` with counter
  management using `.finally()` to ensure decrement on both success and error
- Short-lived operations (evaluate, breed, configureCache, etc.) are unaffected
- `isBusy()` behaviour is unchanged

Closes #2161

## Evidence

All 5272 existing tests pass with 0 failures. The new test file covers all
acceptance criteria transitions.

## Test Plan

- Added `test/workers/LongRunningTaskTracking.ts` with 9 tests:
  - `isRunningLongTask()` returns false when idle
  - `isRunningLongTask()` returns true during a long-running task, false after
    completion
  - `isRunningLongTask()` returns false during short-lived tasks
  - Tracks multiple concurrent long tasks correctly
  - Mixed short and long tasks work together
  - `isBusy()` behaviour is unchanged
  - Decrements correctly on init failure (error case)
  - Idle to discover to idle transition
  - Idle to train to idle transition
