## Summary

Replaces the reactive idle-listener scheduling in `Fitness.calculate()` with a
proactive work-stealing pattern (Issue #1289). Each worker now continuously
pulls creatures from a shared queue until the queue is empty, mirroring the
proven pattern from `ParallelBreeding` (Issue #1026).

### What changed

- **`src/architecture/Fitness.ts`** — Rewrote `calculate()` to use
  `Promise.all(workers.map(processNext))` instead of the old
  `CalculationData` / idle-listener / `_reschedule` machinery. The public API
  is unchanged. Deduplication (Issue #1016) is preserved.

- **`test/architecture/ParallelFitnessEvaluation.ts`** — New test suite
  verifying parallel distribution, deduplication, single-worker fallback,
  empty/pre-scored edge cases, and large-population distribution.

- **`bench/ParallelFitnessEvaluation.ts`** — New benchmark measuring
  evaluation time across 1/2/4 workers for 10/50/100 creature populations.

## Evidence — Benchmark results

```
CPU | Apple M4 Pro
Runtime | Deno 2.6.8

group 10 creatures
| 10 creatures, 1 worker  | 13.4 ms | (baseline)
| 10 creatures, 2 workers |  6.9 ms | 1.94x faster
| 10 creatures, 4 workers |  4.1 ms | 3.22x faster

group 50 creatures
| 50 creatures, 1 worker  | 66.0 ms | (baseline)
| 50 creatures, 2 workers | 33.6 ms | 1.97x faster
| 50 creatures, 4 workers | 17.9 ms | 3.68x faster

group 100 creatures
| 100 creatures, 1 worker  | 131.1 ms | (baseline)
| 100 creatures, 2 workers |  67.3 ms | 1.95x faster
| 100 creatures, 4 workers |  34.2 ms | 3.84x faster
```

Near-linear speedup with worker count. For a typical production population of
100+ creatures with 4+ workers, wall-clock time per generation drops by ~75%.

## Test Plan

- `test/architecture/ParallelFitnessEvaluation.ts` — 7 new tests:
  - Distributes evaluations across multiple workers
  - Parallel evaluation preserves deduplication (Issue #1016)
  - Handles single worker correctly
  - Empty population completes immediately
  - All pre-scored creatures skip evaluation
  - Large population distributed across many workers
  - Mixed scored and unscored creatures
- `test/FitnessDeduplication.ts` — 4 existing tests continue to pass
- Full suite: 2190 tests passing
