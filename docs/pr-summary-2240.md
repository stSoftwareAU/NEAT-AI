## Summary

Prevent `finishUp()` from blocking generations by running full `evolve()` cycles
while waiting for long-running discovery and training tasks. Closes #2240.

Previously, when the evolution loop determined it was "completed" (reached
iteration limit or timeout) but async tasks were still in flight, `finishUp()`
returned `false` causing the loop to run full `evolve()` cycles — including
fitness evaluation, breeding, mutation, and de-duplication — just to poll for
task completion. This wasted worker resources and inflated the generation count.

Now, `awaitInFlightTasks()` uses `Promise.race()` with a configurable timeout to
efficiently wait for in-flight tasks without consuming worker resources. The
training loop calls this lightweight wait when `finishUp()` indicates tasks are
still pending, avoiding unnecessary full generation cycles.

Additionally, `finishUp()` logging now clearly distinguishes between waiting for
discovery tasks (with UUID details) and waiting for training tasks (with UUID
details and task counts), making it easier to diagnose what the system is waiting
for during the finish-up phase.

## Changes

- **`src/NEAT/Neat.ts`**: Added `awaitInFlightTasks(timeoutMs)` method that uses
  `Promise.race` to efficiently wait for in-flight discovery/training promises.
  Updated training-in-progress logging to include task count and UUID details.
- **`src/creature/CreatureTraining.ts`**: Modified the training loop to call
  `awaitInFlightTasks()` when `finishUp()` returns false, replacing repeated full
  `evolve()` cycles with a lightweight wait.

## Evidence

- All 5696 existing tests pass with the changes
- New tests verify `awaitInFlightTasks()` behaviour (immediate resolution,
  task completion waiting, timeout respect, concurrent task handling)

## Test Plan

- Added `test/NEAT/NeatAwaitInFlightTasks.ts` with 6 tests:
  - `awaitInFlightTasks: resolves immediately when no tasks in flight`
  - `awaitInFlightTasks: waits for discovery task to complete`
  - `awaitInFlightTasks: waits for training task to complete`
  - `awaitInFlightTasks: respects timeout with long-running tasks`
  - `awaitInFlightTasks: handles both discovery and training simultaneously`
  - `finishUp: logs waiting message with task counts`
- Existing `test/NEAT/NeatFinishUp.ts` tests all pass unchanged
