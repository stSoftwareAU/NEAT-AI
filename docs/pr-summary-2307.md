## Summary

Profile evolveDir with production-scale data (~1,500 neurons, ~20,000 synapses,
520 training files) and document a comprehensive bottleneck analysis contrasting
with the small-data profiling from #2274. Closes #2307.

### Key Finding: Phase Proportions Invert at Production Scale

At small scale (#2274), **breeding dominates at 50–60%** and fitness is only
13–19%. At production scale, **fitness dominates at 65.7%** and breeding drops
to 29.7%. This is the insight the project owner expected — with production-sized
creatures (~1,500 neurons) and real training data (520 files), WASM activation
and scoring become the overwhelming bottleneck.

### Changes

1. **Benchmark** (`bench/ProductionScaleEvolveDirProfile.ts`): Reproducible
   `Deno.bench()` benchmark profiling evolveDir phases at GRQ-cluster
   dimensions. Includes individual phase benchmarks (activation, serialisation,
   deserialisation) and a full 5-generation evolve run.

2. **Analysis script** (`scripts/analyseProductionProfile.ts`): Reads NDJSON
   profile output and produces a markdown bottleneck analysis with phase
   breakdown, memory patterns, comparison with #2274, and recommendations.

3. **Profile results** (`bench/results/production-scale-evolveDir-profile.md`):
   Documented results from profiling 12 generations at production scale.

4. **Tests** (`test/bench/ProductionScaleEvolveDirProfile.ts`): 3 tests
   validating creature dimensions, phase timing capture, and timing field types.

### Phase Timing Breakdown

| Phase         | Small-Data (~80 neurons) | Production (~1,500 neurons) | Shift          |
| ------------- | -----------------------: | --------------------------: | -------------- |
| fitness       |                    15.5% |                   **65.7%** | ⬆️ up 50.2pp   |
| breeding      |                    53.5% |                   **29.7%** | ⬇️ down 23.8pp |
| mutation      |                     7.2% |                        0.7% | ⬇️ down 6.5pp  |
| deduplication |                     7.5% |                        1.5% | ⬇️ down 6.0pp  |

### Top 5 Bottlenecks

1. **Fitness evaluation (65.7%)** — WASM activation ~11 ms per creature per
   sample
2. **Breeding (29.7%)** — Genome alignment/crossover scales with synapse count
3. **De-duplication (1.5%)** — Cost grows from 313→1,423 ms across generations
4. **Mutation (0.7%)** — Minor at production scale
5. **WASM pre-warming (0.2%)** — Minimal overhead

### Micro-benchmark Results (Apple M4 Pro)

| Benchmark                               | time/iter |
| --------------------------------------- | --------: |
| Single activation (1492N/19968S)        |   11.0 ms |
| Serialisation round-trip (1492N/19968S) |   13.0 ms |
| Deserialisation (1492N/19968S)          |    7.2 ms |

## Evidence

This is a backend profiling/benchmarking task with no UI changes. Evidence is
provided by:

- Profile results in `bench/results/production-scale-evolveDir-profile.md`
- Micro-benchmark output shown above
- 3 passing tests in `test/bench/ProductionScaleEvolveDirProfile.ts`

## Test Plan

- `test/bench/ProductionScaleEvolveDirProfile.ts`:
  - `Production-scale creature has GRQ-cluster dimensions` — validates ~1,500
    neurons and ~20,000 synapses at GRQ-cluster scale
  - `Phase timing events captured during production-scale evolution` — confirms
    generation_complete events are emitted with correct phase timing fields
  - `All phase timing fields are present with correct types` — validates all
    optional timing fields have correct types when present
- Benchmark runs verified: `deno bench bench/ProductionScaleEvolveDirProfile.ts`
