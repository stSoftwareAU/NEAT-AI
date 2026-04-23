## Summary

Split `src/architecture/Training.ts` (previously 784 lines, 7 top-level
functions) into focused phase modules under `src/architecture/training/`. The
public surface is unchanged: `trainDir`, `trainDirSingleFold`, and `dataFiles`
continue to live in `Training.ts`, which is now a thin orchestrator that
composes the phases. Closes #2399.

### New module layout

| File                                                    | Lines | Responsibility                                                                                          |
| ------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------- |
| `src/architecture/Training.ts`                          |   136 | Public entry points (`trainDir`, `trainDirSingleFold`, `dataFiles`).                                    |
| `src/architecture/training/TrainingTypes.ts`            |    30 | Shared `TrainingResult` interface.                                                                      |
| `src/architecture/training/TrainingSetup.ts`            |   240 | Pre-training: option resolution, buffer allocation, synthetic synapse injection, initial sparse config. |
| `src/architecture/training/TrainingSamples.ts`          |   100 | Per-file sample index selection and data augmentation (fuzzing + quantisation).                         |
| `src/architecture/training/TrainingEpoch.ts`            |   205 | Single-epoch pass over all binary files.                                                                |
| `src/architecture/training/TrainingOutcome.ts`          |   127 | Epoch-state construction and improve/regress decision.                                                  |
| `src/architecture/training/TrainingLoop.ts`             |   139 | Outer iteration loop, learning-rate scheduling, termination checks.                                     |
| `src/architecture/training/TrainingTeardown.ts`         |   198 | Post-training: synthetic synapse pruning, trace filtering, compaction, result packaging.                |
| `src/architecture/training/TrainingPredictiveCoding.ts` |    89 | Issue #1556 Predictive Coding pipeline.                                                                 |

No file exceeds 300 lines. No behavioural change — the full training quality
gate (6136 tests) passes with 0 failures.

## Evidence

This is a backend refactor with no UI surface. Correctness is verified by:

- The full `./quality.sh --skip-discovery` suite: **6136 passed | 0 failed | 3
  ignored (56s)**.
- Existing training tests exercise the end-to-end pipeline unchanged:
  `test/NEAT/TrainDirCustomCost.ts`, `test/NEAT/TrainingLoopAllocations.ts`,
  `test/propagate/SyntheticSynapsesIntegration.ts`,
  `test/propagate/SyntheticSynapsesValidation.ts`,
  `test/architecture/CrossValidation.ts`, and the Predictive Coding suite.
- New targeted tests added under `test/architecture/training/` exercise each
  extracted module directly.

## Test Plan

- [x] `test/architecture/training/TrainingSetup.ts` — option resolvers
      (`resolveTargetError`, `resolveIterations`, `resolveTrainingSampleRate`),
      `fp` formatter, `dataFiles` filter, and `prepareTraining` buffer
      allocation.
- [x] `test/architecture/training/TrainingSamples.ts` —
      `selectFileSampleIndexes` index selection and scratch reuse, and
      `applyDataAugmentation` no-op / quantisation branches.
- [x] `test/architecture/training/TrainingTeardown.ts` —
      `wireToRuntimeIdFromExport` mapping, `pruneSyntheticSynapses` no-op on
      empty input, and `stripUntrackedTraces` behaviour.
- [x] `test/architecture/training/TrainingLoop.ts` — drives `trainDir`
      end-to-end on a tiny XOR binary dataset, including the target-error
      early-exit branch.
- [x] Full existing training suite continues to pass unchanged (6136 passed | 0
      failed | 3 ignored).
