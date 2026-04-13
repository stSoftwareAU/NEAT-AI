## Summary

Profile evolveDir per-generation phase timing to identify dominant bottlenecks. Closes #2274.

Added five new optional timing fields to `GenerationPhaseTiming`: `writeScoresMs`, `mutationMs`, `deDuplicationMs`, `speciationMs`, and `sortMs`. These are instrumented in `NeatEvolution.ts` using `Date.now()` bracketing around each phase, matching the existing pattern for `fitnessMs`, `breedingMs`, and `resultProcessingMs`.

Created a comprehensive `Deno.bench()` benchmark in `bench/ProfileEvolveDirPhases.ts` that profiles sort, speciation, mutation, and de-duplication across three creature sizes (small/medium/large) and two population sizes (50/150).

## Benchmark Results (Apple M4 Pro)

### Creature Sizes
| Size   | Neurons | Synapses |
|--------|---------|----------|
| Small  | 50      | 525      |
| Medium | 200     | 9,600    |
| Large  | 370     | 33,000   |

### Phase Timing — Small Creatures (50 neurons, 525 synapses)

| Phase           | Pop=50   | Pop=150   |
|-----------------|----------|-----------|
| Sort            | 0.87 ms  | 2.6 ms    |
| Speciation      | 0.17 ms  | 0.41 ms   |
| **Mutation**    | **35 ms**| **107 ms**|
| **DeDuplication**| **176 ms**| **525 ms**|

### Phase Timing — Medium Creatures (200 neurons, 9,600 synapses)

| Phase           | Pop=50     | Pop=150     |
|-----------------|------------|-------------|
| Sort            | 33 ms      | 136 ms      |
| Speciation      | 0.33 ms    | 0.73 ms     |
| **Mutation**    | **809 ms** | **2,300 ms**|
| **DeDuplication**| **4,400 ms**| -          |

### Top 3 Bottleneck Phases (Ranked)

1. **De-duplication** — Dominant bottleneck at all sizes. Includes Bloom filter checks, UUID computation, previous experiment lookups (file I/O), and replacement breeding when duplicates are found below elitism threshold.
2. **Mutation** — Second most expensive. Scales with creature size due to shallowClone, MCMC penalty computation, and per-creature fix/repair operations.
3. **Sort** — Visible at medium+ creatures. Sort involves cloning for UUID computation (`shallowClone` overhead in the score clone path).

### Recommendations
- De-duplication replacement breeding loop is the single largest cost — optimise `previousExperiment()` file I/O and the iterative breed-or-mutate fallback.
- Mutation `fix()` / `repairAfterMutation()` is called per-creature — investigate batching or deferring.
- Sort cost is proportional to creature size due to UUID/clone overhead in the comparison path.

## Evidence

This is a backend/CLI performance profiling change — no visual output to screenshot. Evidence is the benchmark results above and passing tests.

## Test Plan

- Added `test/NEAT/EvolvePhaseTiming_Extended.ts` with 3 tests:
  - Verifies new phase fields are present in phaseTiming data from `generation_complete` events
  - Verifies new timing fields are optional in `GenerationPhaseTiming` type
  - Verifies all timing fields are numbers or undefined across multiple generations
- All 21 related timing tests pass (original + extended + checkpoint + memory eviction + evolve tests)
- Benchmark script `bench/ProfileEvolveDirPhases.ts` committed with profiling across 3 creature sizes × 2 population sizes
