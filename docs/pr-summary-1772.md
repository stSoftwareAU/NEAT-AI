## Summary

Audit all test files for compaction and optimisation (~64 files, ~193 test cases) across
`test/Compact/`, `test/optimize/`, `test/optimization/`, `test/FeedForward/`, and
`test/reconstruct/`. Removes duplicate tests, strengthens weak assertions, and improves
test names. Closes #1772.

## Changes

### Duplicate tests removed (8 files deleted)

**test/Compact/** — 4 re-export test files that duplicated tests already in `CompactUtils.ts`:
- `DeadSubgraphPruningModule.ts` — duplicated `pruneDeadSubgraphs` tests
- `MemeticCleanup.ts` — duplicated `cleanupMemeticForRemovedSynapse/Neuron` tests
- `OrphanedNeuronCleanup.ts` — duplicated `cleanupOrphanedNeurons` tests (unique
  `cleanupOrphanedNeuronsInCreature` test moved to `CleanupOrphanedNeurons.ts`)
- `SynapsePruning.ts` — duplicated `mergeDuplicateSynapses`/`pruneZeroWeightSynapses` tests

**test/optimization/** — 4 learning rate test files with weak/meaningless assertions,
all superseded by `LearningRateVerification.ts`:
- `LearningRateBugDetection.ts` — self-admitted non-test (`error >= 0` assertion)
- `LearningRateBugTest.ts` — duplicate with `error >= 0` assertion
- `LearningRateIntegration.ts` — duplicate with `error >= 0` assertion
- `LearningRateIntegrationTest.ts` — duplicate with `difference >= 0` assertion

**test/optimize/** — 1 duplicate test removed:
- `RELU.ts` "Constant-max" — identical to `Constant.ts` "Constant-max"

### Weak assertions strengthened (3 files modified)

- `AdaptiveLearningRate.ts` — replaced weak `error < 1.0` convergence checks with precise
  `assertAlmostEquals` assertions on calculated learning rates
- `MiniBatch.ts` — strengthened partial batch test from `error >= 0` to verify finite error
  and meaningful training reduction
- `Large.ts` — added determinism check (same input produces identical output) and proper
  `assertEquals`/`assert` assertions

### Test names improved

- `SparseSelection.ts` — improved names to describe what is being verified
- `RELU.ts` — renamed to "RELU activation produces correct clamped output"
- `Large.ts` — renamed to "large network activation produces finite deterministic output"

### Cross-area duplicates found

- `test/Compact/CompactUtils.ts` contained tests that overlapped with `CleanupOrphanedNeurons.ts`,
  `MergeDuplicateSynapses.ts`, and `ZeroWeightSynapsePruning.ts`. The CompactUtils tests were
  retained as the canonical versions since they test the public re-export barrel.
- No cross-area duplicates found between `test/optimize/` and `test/optimization/` — they test
  different concerns (activation/simplification vs training strategies).

### Directories with no changes needed

- `test/FeedForward/` (8 files, 21 tests) — all tests are high-quality behavioural tests
- `test/reconstruct/` (3 files, 23 tests) — all tests verify outcomes with appropriate assertions

## Evidence

All 4539 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- Verified all remaining tests still pass after removing duplicates
- Verified strengthened assertions correctly test the intended behaviour
- Verified no test coverage was lost (all removed tests were exact duplicates of retained tests)
