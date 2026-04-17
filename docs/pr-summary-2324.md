## Summary

Add worker-path breeding sub-phase telemetry so production runs using worker
handlers emit the same fine-grained timing breakdown as the main-thread path.
Closes #2324.

Previously, `ParallelBreeding.lastBreedingSubPhases` was only populated for the
non-worker (main-thread) breeding path. Worker-based breeding lost visibility
into where breeding time was spent (genetic compatibility, alignment/crossover,
neuron sort, batch connections, post-breeding repair).

### Changes

- **`WorkerProcessor.ts`**: Create a `BreedingSubPhaseAccumulator` for each
  worker breeding call, pass it to `Offspring.breed()`, and include the frozen
  `subPhaseTiming` in the breed response.
- **`WorkerHandler.ts` (`ResponseData.breed`)**: Add optional `subPhaseTiming`
  field of type `BreedingSubPhaseTiming` to the breed response interface.
- **`ParallelBreeding.ts`**: Accept the accumulator in `breedWithWorkers()` and
  aggregate sub-phase timing from each successful worker response back into the
  main-thread accumulator before freezing it into `lastBreedingSubPhases`.

The aggregated timing flows into `generation_complete.phaseTiming.breedingSubPhases`
unchanged, so existing consumers (benchmark/profile scripts) automatically gain
worker-path sub-phase percentages.

## Evidence

This is a backend/telemetry change with no UI. Evidence is provided via the
test results below.

## Test Plan

- Added `test/breed/WorkerBreedingSubPhaseTiming.ts` with 5 tests:
  - Worker-path breeding populates `lastBreedingSubPhases`
  - Worker-path breeding aggregates timing across multiple workers
  - Worker-path breeding sub-phases include parent selection timing
  - Worker-path breeding sub-phases match `BreedingSubPhaseTiming` shape
  - Failed worker responses do not contribute to sub-phases
- All 19 existing breeding tests continue to pass (no regressions)
