## Summary

Fixes the "Training X caused a higher error" rollback loop observed in
`GRQ-22-sloth.log` (217 events per run) by introducing a per-creature training
regression tracker that `scheduleTraining` consults before dispatching work to
a heavy worker. Closes #2382.

Root cause: `scheduleTraining` unconditionally dispatches training for every
elitist whose UUID is not already in flight, even when prior attempts on that
same creature consistently produced a higher error and no usable fine-tune
variant. On the reference workload the single-iteration training schedule
(`iterations: 1`, `targetError: 0.05`) regressed ~100% of the time, wasting
heavy-pool cycles on rollbacks that `fineTuneImprovement` could not rescue.

Fix: `src/NEAT/TrainingRegressionTracker.ts` records per-UUID consecutive
regression streaks and aggregate counters. `scheduleTraining` now skips
creatures that have regressed `skipTrainingAfterConsecutiveRegressions` times
in a row (default `2`, set to `0` to disable). Any improvement — including a
successful `fineTuneImprovement` backtrack or forward variant — resets the
streak so the creature is eligible again when the gradient landscape changes.

## Evidence

No UI surface. Verification is via unit and integration tests plus the full
quality gate:

- `test/NEAT/TrainingRegressionTracker.ts` — 8 tests covering happy path,
  rollback streak, skip trigger, streak reset on improvement, threshold-0
  disable, aggregate regression rate, reset, and unknown UUID.
- `test/NEAT/TrainingRegressionSkip.ts` — 3 integration tests that build a
  real `Neat` instance, seed the tracker, and assert that `scheduleTraining`
  does not populate `trainingInProgress`, does not touch
  `alreadyScheduledMap`, and increments `totalSkipped` on the skip path.
- `./quality.sh --skip-discovery --skip-wasm` — lint, type-check, and full
  test suite pass: `ok | 6017 passed (2 steps) | 0 failed | 3 ignored (1m8s)`.

The pre-fix scheduler would dispatch training for every elitist regardless of
prior regression history. With the new guard and default threshold of `2`, a
creature that regresses twice in a row is bypassed — matching the acceptance
criterion "training is skipped for creatures where regression is predicted".

## Test Plan

- [x] `deno test --no-check --allow-all test/NEAT/TrainingRegressionTracker.ts`
      — 8 passed
- [x] `deno test --no-check --allow-all test/NEAT/TrainingRegressionSkip.ts`
      — 3 passed
- [x] `deno test --no-check --allow-all test/NEAT/*.ts` — 630 passed
- [x] `deno test --no-check --allow-all test/config/*.ts` — 329 passed
- [x] `./quality.sh --skip-discovery --skip-wasm` — 6017 passed, 0 failed
