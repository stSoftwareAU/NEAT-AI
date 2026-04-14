## Summary

Add sub-phase timing instrumentation within the breeding phase to identify
the actual hotspot within the 50–60% wall-clock time consumed by breeding.
Closes #2284.

PR #2281 identified breeding as the dominant bottleneck, but timing was at
the phase level only. This PR adds finer-grained instrumentation around
six sub-operations within `Offspring.breed()` and
`ParallelBreeding.breedBatch()`:

- **parentSelection** — selecting parent pairs via FitnessRanking
- **geneticCompatibility** — computing compatibility between parents
- **alignmentCrossover** — genome alignment, neuron map building, crossover
- **sortNeurons** — dependency-aware topological sorting
- **batchConnection** — batch synapse building with deduplication
- **postBreedingRepair** — forward-only enforcement, UUID uniqueness, validation

### Changes

- `BreedingSubPhaseTiming` interface added to `TrainingEvent.ts`
- `BreedingSubPhaseAccumulator` class for aggregating timing across offspring
- `Offspring.breed()` instrumented with accumulator (zero-cost when not provided)
- `ParallelBreeding.breedBatch()` creates accumulator, times parent selection,
  exposes `lastBreedingSubPhases`
- `NeatEvolution.ts` wires sub-phase timing into `GenerationPhaseTiming`
- `EvolveDirPhaseProfile.ts` extended to report breeding sub-phase percentages
- New `BreedingSubPhaseProfile.ts` benchmark for direct sub-phase profiling

## Evidence

### Benchmark Results (Apple M2 Ultra)

**Small (~10 neurons) × pop 50** — 10 batches, ~15 offspring/batch:

| Sub-phase | % of Breeding |
|---|---|
| postBreedingRepair | 34–44% |
| parentSelection | 34–38% |
| alignmentCrossover | 12–28% |
| batchConnection | 0–8% |
| sortNeurons | 0–2% |
| geneticCompatibility | 0–3% |

**Medium (~30 neurons) × pop 50** — 10 batches, ~23 offspring/batch:

| Sub-phase | % of Breeding |
|---|---|
| postBreedingRepair | 52–55% |
| parentSelection | 16–21% |
| sortNeurons | 8–13% |
| alignmentCrossover | 7–9% |
| batchConnection | 7–11% |
| geneticCompatibility | 0–1% |

**Large (~80 neurons) × pop 50** — 10 batches, ~26 offspring/batch:

| Sub-phase | % of Breeding |
|---|---|
| postBreedingRepair | 56–59% |
| parentSelection | 13–15% |
| sortNeurons | 12–14% |
| batchConnection | 8–10% |
| alignmentCrossover | 4–6% |
| geneticCompatibility | 0–1% |

### Key Findings

**Top 3 sub-operations by wall-clock percentage:**

1. **postBreedingRepair** (34–59%) — The dominant hotspot across all sizes.
   Includes forward-only topology enforcement, `creatureValidate()`,
   `ensureUniqueNeuronUuids()`, and `fixAliases` export/import round-trip.
   Grows in proportion as creature size increases.

2. **parentSelection** (13–38%) — Significant overhead from fitness ranking
   and parent pair selection. Decreases proportionally as creature size
   grows (algorithm complexity is O(1) per selection).

3. **sortNeurons** (0–14%) — Becomes material for medium/large creatures.
   The O(n²) nested loop in dependency resolution scales poorly.

**geneticCompatibility** is negligible (<3%) thanks to the distance cache.

## Test Plan

- 9 new tests in `test/breed/BreedingSubPhaseTiming.ts`:
  - `BreedingSubPhaseAccumulator - toTiming returns all fields`
  - `BreedingSubPhaseAccumulator - toTiming returns frozen object`
  - `BreedingSubPhaseAccumulator - accumulates across multiple calls`
  - `Offspring.breed - populates sub-phase accumulator when provided`
  - `Offspring.breed - accumulator is additive across multiple breedings`
  - `Offspring.breed - works without accumulator (backward compatible)`
  - `ParallelBreeding - breedBatch populates lastBreedingSubPhases`
  - `ParallelBreeding - empty batch clears lastBreedingSubPhases`
  - `BreedingSubPhaseTiming - included in GenerationPhaseTiming via evolveDataSet`
- All 5791 existing tests pass without regression
- New benchmark `bench/BreedingSubPhaseProfile.ts` run on 3 configuration sizes
