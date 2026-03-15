## Summary

Audit of all test files in `test/NEAT/` (46 files) for quality issues including
duplicates, placeholder assertions, timing-based measurements, and misleading
test names. Addresses #1768.

### Changes made

**Duplicate file removed (1 file, 6 tests):**

- `test/NEAT/MutatorInstanceCache.ts` — entirely redundant. Every test was a
  near-duplicate of tests in `MutatorBehavioural.ts`,
  `MutatorMutateCreature.ts`, or `MutatorSelectMutationMethod.ts`. File name was
  misleading (tested general mutation behaviour, not instance caching).

**Duplicate tests removed (6 tests across 2 files):**

- `MutatorBehavioural.ts`: Removed 2 `calculateMaxSynapses` tests (exact
  duplicates of tests in the dedicated `MutatorCalculateMaxSynapses.ts` file)
- `MutatorMutate.ts`: Removed 4 tests — "mutates creatures based on mutation
  rate" and "does not mutate when rate is very low" (duplicated in
  `MutatorBehavioural.ts`), "preserves creature input/output dimensions"
  (duplicated in `MutatorBehavioural.ts`), and "clears approach tags after
  mutation" (misleading name with no relevant assertion)

**Placeholder assertions removed (15 occurrences across 4 files):**

- `NeatFinishUp.ts`: Removed test "sets doNotStartMore flag" — contained
  `assertEquals(true, true)` and was already covered by the "returns false when
  training is in progress" test which explicitly checks `neat.doNotStartMore`
- `NeatSchedulingLogReplaySummary.ts`: Removed 11 `assert(true, ...)` no-op
  assertions from smoke tests (tests still exercise real code paths)
- `NeatConstruction.ts`: Removed 1 `assert(true, ...)` placeholder
- `TrainingEventEmitter.ts`: Removed 2 `assert(true, ...)` placeholders

**Timing API removed (1 test):**

- `MutatorCacheValidMutations.ts`: Removed `performance.now()` usage which
  violates the no-timing-in-tests rule

**Misleading test names fixed (3 tests):**

- `MutatorCacheValidMutations.ts`: Renamed tests whose names referenced internal
  cache implementation details to describe the observable behaviour instead

### Cross-area duplicates noted

- `MutatorInstanceCache.ts` duplicated tests from `MutatorBehavioural.ts`,
  `MutatorMutateCreature.ts`, and `MutatorSelectMutationMethod.ts`
- `MutatorBehavioural.ts` calculateMaxSynapses tests duplicated
  `MutatorCalculateMaxSynapses.ts`
- `MutatorMutate.ts` mutation rate tests duplicated `MutatorBehavioural.ts`

## Evidence

All 4750 tests pass. `./quality.sh` passes cleanly.

## Test Plan

- No new tests added — this is a cleanup audit
- Verified all remaining tests pass after removing duplicates and placeholders
- Verified `./quality.sh` passes
