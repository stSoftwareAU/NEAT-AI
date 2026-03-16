## Summary

Apply DRY principle and fix inconsistencies across evolution, training, and
discovery code. Closes #1392.

Six improvements extracted from a systematic codebase review:

1. **Shared `isAggregationSquash` utility** (`SquashUtils.ts`): Unified the
   duplicate `isAggregationSquash` / `isAggregationSquashName` functions from
   `CompactCreature.ts` and `Simplify.ts` into a single shared function. Uses a
   `ReadonlySet` for O(1) lookup instead of a switch statement.

2. **Shared parent selection** (`ParentSelection.ts`): Extracted duplicated
   `selectParent` and `getDad` logic from `Breed.ts` (~120 lines) and
   `ParallelBreeding.ts` (~70 lines) into shared `selectParent()` and
   `findFather()` functions. Both breeding paths now use the same selection and
   father-finding logic.

3. **MemeticUpdate duplicate loop removal** (`MemeticUpdate.ts`): Removed an
   exact duplicate loop (lines 25-29 were identical to 19-23) and a duplicate
   `foundSet.delete()` call. No behavioural change.

4. **Type safety for `discovery-replay`** (`LogApproach.ts`, `Neat.ts`): Added
   `"discovery-replay"` to the `Approach` type union and switch statement,
   eliminating the need for `as Approach` casts. Removed three such casts from
   `DiscoveryReplayIntegration.ts`.

5. **ModSquash focus-list relaxation** (`ModSquash.ts`): Fixed an inconsistency
   where `ModBias` relaxes its focus-list constraint after 6 failed attempts but
   `ModSquash` never relaxed, causing mutations to silently fail when the focus
   list contained no eligible neurons. ModSquash now matches ModBias behaviour.

6. **Test coverage**: Five new test files (26 tests total) covering all changes
   above, written before implementation following TDD.

## Evidence

This is a backend-only refactoring and bug-fix change. All 2553 tests pass
(including 26 new tests across five files).

## Test Plan

- Added `test/compact/IsAggregationSquash.ts` — 11 tests for the shared utility
- Added `test/breed/ParentSelection.ts` — 5 tests for shared parent selection
- Added `test/blackbox/MemeticUpdateDuplicateLoop.ts` — 5 tests for memetic
  update bias/weight change tracking
- Added `test/NEAT/LogApproachDiscoveryReplay.ts` — 2 tests for discovery-replay
  approach type safety
- Added `test/mutate/ModSquashFocusRelaxation.ts` — 3 tests for focus-list
  relaxation behaviour
