## Summary

Cache FitnessRanking and NeatConfig per generation to eliminate redundant object
creation during breeding. Closes #1538.

**Changes:**

- **Breed.ts**: Cache `NeatConfig` at construction time; use it directly in
  `breed()` instead of re-calling `createNeatConfig()` on every invocation.
  Accept an optional pre-computed `FitnessRanking` parameter so callers (e.g.
  DeDuplicator) can reuse the same ranking across multiple breed calls within a
  generation.
- **ParallelBreeding.ts**: Store `NeatConfig` directly instead of copying to
  `NeatOptions` and re-parsing. `FitnessRanking` was already computed once per
  batch — no change needed there.
- **Neat.ts**: Replace `createNeatConfig({...spread})` with lightweight
  `Object.freeze({...override})` for both the plateau mutation-rate adjustment
  and the discovery timeout override, avoiding full config re-parsing and
  re-validation.

## Evidence

This is a backend/CLI change with no visual output. Performance was verified via
benchmarks:

**Benchmark: `bench/BreedCaching.ts`** — No regression observed:

| Benchmark                                | Before (avg) | After (avg) |
| ---------------------------------------- | ------------ | ----------- |
| Breed.breed() x50 (pop=20)               | 7.5 ms       | 7.2 ms      |
| Breed.breed() x50 (pop=50)               | 7.3 ms       | 7.1 ms      |
| ParallelBreeding.breedBatch(50) (pop=50) | 7.1 ms       | 7.0 ms      |

**Benchmark: `bench/BreedPerformance.ts`** — No regression in Offspring.breed()
performance.

The savings from avoiding `createNeatConfig()` (which re-parses ~80 fields and
validates cross-field constraints) are most impactful in real workloads with
larger populations and more generations, where the overhead accumulates.

## Test Plan

- Added `test/breed/BreedCaching.ts` with 5 tests:
  - Breed with pre-computed FitnessRanking produces valid offspring
  - Breed without FitnessRanking still creates one internally
  - Breed handles globalBreedingRate override correctly (DeDuplicator path)
  - Breed reuses same ranking for multiple breed calls
  - ParallelBreeding uses cached config per batch
- All 4164 existing tests pass (0 failures)
- Added `bench/BreedCaching.ts` benchmark for ongoing regression monitoring
