## Summary

Pipeline sequential main-thread phases to overlap with worker tasks in the
evolution loop, reducing the time workers sit idle between phases. Closes #2314.

Two phase overlaps implemented:

1. **Breeding + result processing/plateau/MCMC config**: Start breeding as a
   non-blocking promise and perform result processing, plateau detection, and
   MCMC configuration on the main thread while workers breed. These phases are
   independent — result processing reads completed task queues from the previous
   generation; plateau/MCMC configuration reads neat-level state that breeding
   does not modify.

2. **Deduplication + WASM pre-warming**: Start dedup as a non-blocking promise
   and run WASM cache pre-warming during dedup's async I/O pauses
   (previousExperiment file stat checks). Pre-warming the pre-dedup population
   is safe because duplicate creatures share topology with existing population
   members, producing no extra WASM template compilations.

Added `pipelineOverlapMs` field to `GenerationPhaseTiming` that reports the
wall-clock time saved by running phases concurrently. This enables the stronger
timing invariant `totalMs >= sum - pipelineOverlapMs` and provides production
observability into pipeline effectiveness.

## Evidence

This is a backend/performance change with no UI. Evidence is from test results
and benchmarks.

**All tests pass**: 5882 passed | 0 failed | 3 ignored (quality.sh clean)

**Benchmark results** (`deno bench bench/PhasePipelining.ts`):

| Configuration         | breeding | mutation | dedup | preWarm | total |
| --------------------- | -------- | -------- | ----- | ------- | ----- |
| small (10n × 50pop)   | 14ms     | 2ms      | 2ms   | 1ms     | 26ms  |
| medium (30n × 100pop) | 140ms    | 15ms     | 15ms  | 6ms     | 221ms |
| large (60n × 150pop)  | 181ms    | 17ms     | 30ms  | 9ms     | 336ms |

The overlapped phases (result processing runs during breeding; pre-warming runs
during dedup I/O pauses) are hidden behind the longer worker tasks rather than
adding to total wall-clock time. At production scale with larger populations and
experiment stores, the dedup I/O overlap becomes more significant as
`previousExperiment()` file checks take longer.

## Test Plan

- Added `test/NEAT/PhasePipelining.ts` with 5 tests:
  - Single-threaded evolution correctness with overlapped phases
  - Multi-threaded evolution correctness with pipelining
  - Population size maintained after pipelined phases
  - `pipelineOverlapMs` reports overlap and maintains timing invariant
  - `pipelineOverlapMs` type is optional in GenerationPhaseTiming
- Updated `test/NEAT/EvolvePhaseTiming.ts` — totalMs assertion accounts for overlap
- Updated `test/NEAT/EvolvePhaseTiming_Extended.ts` — added pipelineOverlapMs
  validation and updated totalMs invariant to use overlap
- Added `bench/PhasePipelining.ts` for phase timing measurement
- All 5882 tests pass
