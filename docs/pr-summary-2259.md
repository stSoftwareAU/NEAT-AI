## Summary

Benchmarked the main-thread `Score.calculate` work per fitness evaluation to test the hypothesis that main-thread score/tag work could become a measurable bottleneck as synapse counts grow. Closes #2259.

**Result: No meaningful improvement possible — the main-thread score path is already negligible.**

## Benchmark Results

The benchmark (`bench/MainThreadScoreWork.ts`) isolates the per-creature main-thread work after `worker.evaluate` returns: `calculateScore` + `addTag` propagation + duplicate copying. Tested across 5 network sizes (35 to 70,500 synapses).

| Size | Synapses | Full work | Score (cached) | Tags | % of worker |
|------|----------|-----------|----------------|------|-------------|
| Small | 35 | 677ns | 315ns | 192ns | 0.007% |
| Medium | 430 | 376ns | 259ns | 170ns | 0.004% |
| Large | 2,650 | 364ns | 232ns | 133ns | 0.004% |
| XL | 11,375 | 238ns | 185ns | 196ns | 0.002% |
| XXL | 70,500 | 284ns | 203ns | 129ns | 0.003% |

**Key findings:**
- Full main-thread work per creature: **200–700 nanoseconds** (constant, not scaling with synapse count)
- Cached score calculation is O(1) thanks to Issue #1011's caching
- Tag operations are trivially fast (130–200ns)
- Population of 200 creatures: **0.05–0.14ms total** vs typical worker time of 10ms+ per creature
- Main-thread score work is **<0.01%** of worker evaluation time at all sizes

**Conclusion:** The Issue #1011 score component caching already makes `calculateScore` O(1) on the main thread. There is no optimisation opportunity — the main-thread score path is negligible relative to WASM/dataset evaluation time, confirming the issue's "if not meaningful" outcome.

## Evidence

This is a backend/CLI performance investigation with no UI changes. Evidence is the benchmark output above, produced by `deno run -A bench/MainThreadScoreWork.ts`.

## Test Plan

- Added `bench/MainThreadScoreWork.ts` benchmark covering 5 network sizes (35–70,500 synapses)
- Benchmark measures: full main-thread work, cached score, uncached score, and tag operations independently
- No code changes to production files — negative result, benchmark documents the learnings
