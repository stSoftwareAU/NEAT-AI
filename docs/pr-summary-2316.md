## Summary

Wire up adaptive population sizing with worker-aware floor for better CPU
utilisation at production scale. Closes #2316.

The existing `computeAdaptivePopulationSize()` function (created in #1863) was
implemented but **never called** — dead code. This PR connects it into the
evolution loop in `NeatEvolution.ts` and adds a **worker-aware minimum floor**
(`minCreaturesPerWorker`) that ensures enough creatures per worker for good
parallel utilisation.

### Problem

With the default configuration (`populationSize = 50`) on a 32-core production
machine (`threads = 34`), each worker gets only ~1.5 creatures to evaluate.
Workers that happen to get small-topology creatures finish instantly and sit
idle waiting for workers evaluating larger creatures. The ratio
`populationSize / threads` directly affects worker utilisation during fitness
evaluation and breeding.

### Solution

- **Connected adaptive population sizer** to the evolution loop — it now
  adjusts `effectivePopulationSize` each generation based on species diversity
  and convergence state.
- **Added `minCreaturesPerWorker`** config (default: 3) that sets a floor of
  `workerCount × minCreaturesPerWorker` — on a 34-thread machine this ensures
  at least 102 creatures, giving every worker multiple creatures to evaluate.
- **Added `effectivePopulationSize`** state field to `Neat` class, initialised
  from `config.populationSize` and updated each generation.
- **Added `PopulationResizedEvent`** training event emitted when the effective
  population size changes, with reason tracking (low diversity, high diversity
  plateau, worker floor, or combined).

### Key design decisions

- Adaptive sizing is **disabled by default** (`enabled: false`) — no change to
  existing behaviour unless explicitly opted in.
- The worker-aware floor is applied **after** the diversity-based sizing, as an
  independent concern (`Math.max(adaptiveSize, workerFloor)`).
- The sizing computation adds ~4–7ns per generation (benchmark verified) — zero
  practical overhead.

## Evidence

This is a backend/algorithm change with no visual output. Evidence is provided
through:

- **Unit tests**: 22 tests covering all sizing scenarios (16 sizer + 6 config)
- **Benchmark results** (`bench/AdaptivePopulationSizing.ts`):

```
group adaptive-sizing-overhead
  computeAdaptivePopulationSize - disabled (passthrough)     4.5 ns
  computeAdaptivePopulationSize - enabled, normal diversity  4.5 ns
  computeAdaptivePopulationSize - enabled, low diversity     4.0 ns
  computeAdaptivePopulationSize - enabled, high div+plateau  4.5 ns

group worker-floor-scaling
  worker-aware floor - 8-core (10 threads)   7.0 ns
  worker-aware floor - 16-core (18 threads)  6.9 ns
  worker-aware floor - 32-core (34 threads)  6.8 ns
  worker-aware floor - 64-core (66 threads)  6.8 ns

group convergence-simulation
  50-generation low-diversity growth          283.6 ns
  50-generation mixed-scenario convergence    160.2 ns
```

The computation is negligible (~4ns) relative to generation times of hundreds of
milliseconds.

- **Full quality gate**: 5892 tests passed, 0 failed, with `quality.sh --skip-discovery --skip-wasm`

## Test Plan

- Extended `test/NEAT/AdaptivePopulationSizer.ts` with 8 new tests:
  - `minCreaturesPerWorker default is 3` — verifies config default
  - `worker floor raises effective size` — 34 workers × 3 = 102 floor
  - `worker floor has no effect with few workers` — 5 workers × 3 = 15 < 50
  - `worker floor disabled when minCreaturesPerWorker is 0` — opt-out path
  - `growth combined with worker floor` — diversity growth + worker floor
  - `successive growth across generations` — multi-generation accumulation
  - `growth capped at maxPopulationFraction` — bounds enforcement
  - `shrink then stabilise` — diversity-driven shrink followed by stability
- Extended `test/config/AdaptivePopulationConfig.ts` with 2 new tests:
  - `minCreaturesPerWorker defaults to 3`
  - `minCreaturesPerWorker can be 0 to disable floor`
- Added `bench/AdaptivePopulationSizing.ts` benchmarking sizing computation
  overhead at various scales
