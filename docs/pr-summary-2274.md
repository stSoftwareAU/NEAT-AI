## Summary

Add per-generation phase timing instrumentation for writeScores, mutation,
de-duplication, speciation, and sort phases, plus a comprehensive profiling
benchmark that captures timing breakdowns across multiple creature and
population sizes. Closes #2274.

### Changes

1. **New timing fields in `GenerationPhaseTiming`**
   (`src/config/TrainingEvent.ts`):
   - `writeScoresMs` — synchronous per-creature score file I/O
   - `mutationMs` — sequential population mutation via `Mutator.mutate()`
   - `deduplicationMs` — Bloom filter + Set-based de-duplication
   - `speciationMs` — Genus species assignment via `Genus.addCreature()`
   - `sortMs` — O(n log n) score sort after fitness evaluation

2. **Instrumentation in `NeatEvolution.ts`**: Wrapped each phase with
   `Date.now()` timing and included results in the `phaseTiming` object emitted
   via `generation_complete` events.

3. **Benchmark script** (`bench/EvolveDirPhaseProfile.ts`): Profiles the
   evolution loop across 3 creature sizes (small, medium, large) x 2 population
   sizes (50, 150) for 12+ generations each. Outputs per-phase percentage
   breakdowns and identifies top bottlenecks.

## Evidence

### Benchmark Results (Apple M4 Pro, Deno 2.7.12)

| Configuration           | Avg Total | Breeding | Fitness | Mutation | Dedup | Speciation | WriteScores |
| ----------------------- | --------- | -------- | ------- | -------- | ----- | ---------- | ----------- |
| Small (~10n) x pop 50   | 18ms      | 52%      | 18%     | 4%       | 6%    | 1%         | 0%          |
| Small (~10n) x pop 150  | 47ms      | 53%      | 17%     | 4%       | 7%    | 1%         | 0%          |
| Medium (~30n) x pop 50  | 61ms      | 53%      | 16%     | 7%       | 8%    | 1%         | 0%          |
| Medium (~30n) x pop 150 | 154ms     | 60%      | 13%     | 10%      | 9%    | 1%         | 0%          |
| Large (~80n) x pop 50   | 166ms     | 52%      | 16%     | 9%       | 8%    | 0%         | 0%          |
| Large (~80n) x pop 150  | 628ms     | 53%      | 15%     | 9%       | 7%    | 0%         | 0%          |

### Top 3 Bottlenecks (consistent across all configurations)

1. **Breeding (50-60%)** — Dominant phase across all sizes. Parallel breeding
   with crossover, genome alignment, and offspring validation.
2. **Fitness evaluation (13-19%)** — WASM-based creature activation and scoring.
   Percentage decreases slightly with larger populations as breeding cost grows.
3. **Mutation + De-duplication (7-17% combined)** — Both scale with population
   size. Mutation involves sequential per-creature operator application;
   de-duplication uses Bloom filter + Set with replacement breeding.

### Recommendations for optimisation targets

- **Breeding** is the clear primary target at 50-60% of wall-clock time
- **Mutation** and **De-duplication** are secondary targets that become more
  significant at larger population sizes
- **writeScores** and **speciation** are negligible (<1%) and do not warrant
  optimisation

## Test Plan

- Added `test/config/PhaseTimingFields.ts` with 4 tests:
  - `mutationMs present in phaseTiming` — verifies mutation timing is reported
  - `deduplicationMs present in phaseTiming` — verifies de-duplication timing is
    reported
  - `speciationMs present in phaseTiming` — verifies speciation timing is
    reported
  - `phaseTiming fields sum to approximately totalMs` — verifies instrumented
    phases don't exceed total
- Verified existing tests pass: `CheckpointWriteTiming.ts` (2 tests),
  `EvolvePhaseTiming.ts` (1 test)
- Full quality gate: 5755 tests passed, 0 failed
