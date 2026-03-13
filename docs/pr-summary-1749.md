## Summary

Add unit tests for NEAT core modules that lacked direct test coverage. Closes #1749.

New test files created:
- `test/NEAT/Mutation.ts` — Tests for mutation strategy definitions, collections (FFW/ALL), immutability, and uniqueness
- `test/NEAT/TrainingEventEmitter.ts` — Tests for event delivery, undefined callback no-op, exception handling, and multiple event types
- `test/NEAT/NeatSchedulingLogReplaySummary.ts` — Tests for replay summary logging with various result states (improvements, pruning, timeouts, verbose mode)

Extended existing test files:
- `test/NEAT/NeatFinishUp.ts` — Added tests for training/discovery in-progress, discovery timeout, additional generation counting, and cleanup delays
- `test/NEAT/MutationStabilityTrackerBehavioural.ts` — Added edge cases for window size of 1, exact threshold boundary, FAILED outcome non-reclassification, zero scores, per-type window independence, all-brittle stability score, and partial brittleness magnitude interpolation

## Evidence

All 4861 tests pass (including 30+ new tests). `./quality.sh` passes cleanly.

## Test Plan

- `test/NEAT/Mutation.ts` — 13 tests covering individual strategies, FFW/ALL collections, immutability, and uniqueness
- `test/NEAT/TrainingEventEmitter.ts` — 8 tests covering event delivery, undefined callback, exception handling, and multiple event types
- `test/NEAT/NeatSchedulingLogReplaySummary.ts` — 11 tests covering no-improvement, improvement, edge cases (zero/pruned/skipped/timed-out), verbose mode, and combined summary parts
- `test/NEAT/NeatFinishUp.ts` — 5 new tests for discovery/training in-progress, discovery timeout, additional generations, and cleanup delays
- `test/NEAT/MutationStabilityTrackerBehavioural.ts` — 7 new tests for edge cases and boundary conditions
