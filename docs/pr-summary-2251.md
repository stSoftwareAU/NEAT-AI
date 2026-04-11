## Summary

Include checkpoint (writeCreatures) wall time in training telemetry. Extends `GenerationPhaseTiming` with an optional `checkpointWriteMs` field that is populated only when a checkpoint runs that generation, adding negligible overhead when checkpoints are disabled. Closes #2251.

## Changes

- **`src/config/TrainingEvent.ts`**: Added optional `checkpointWriteMs` to `GenerationPhaseTiming` interface.
- **`src/creature/CreatureTraining.ts`**: Moved checkpoint write before event emission and wrapped it with `Date.now()` timing. The measured duration is attached to `phaseTiming.checkpointWriteMs` in the `generation_complete` event.
- **`test/config/CheckpointWriteTiming.ts`**: New test file verifying:
  - `checkpointWriteMs` is present and non-negative when `checkpointEveryGeneration` is enabled.
  - `checkpointWriteMs` is `undefined` when checkpoints are not active.

## Evidence

This is a backend/telemetry change with no UI. Evidence is provided by passing tests:
- `test/config/CheckpointWriteTiming.ts` — 2 tests verifying the timing field presence/absence
- `test/NEAT/EvolvePhaseTiming.ts` — existing phase timing test continues to pass
- `test/config/CheckpointEveryGeneration.ts` — existing checkpoint tests continue to pass
- Full quality gate: 5716 passed, 0 failed

## Test Plan

- [x] `checkpointWriteMs` present and non-negative when `checkpointEveryGeneration: true`
- [x] `checkpointWriteMs` undefined when `checkpointEveryGeneration: false`
- [x] All existing phase timing and checkpoint tests pass unchanged
- [x] Full quality gate passes cleanly
