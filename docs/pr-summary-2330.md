## Summary

Add a compact per-generation throughput metrics payload to `generation_complete`
training events so production runs can diagnose wall-clock usage, per-phase
time, and worker queueing pressure without per-creature logging. Closes #2330.

Previously, `generation_complete` events exposed only aggregate `phaseTiming`
numbers. Operators could see *where* time was spent but had no compact way to
answer questions like "how idle were workers?", "how deep did the breeding
backlog get?", or "how much time did tasks spend waiting?". This PR adds a
`throughput` field on `generation_complete` carrying finite, non-negative
numeric counters suitable for dashboards and CSV exports.

### Changes

- **`src/config/TrainingEvent.ts`**: New `GenerationThroughputMetrics`
  interface with 11 readonly numeric fields — `wallClockMs`, `nonFitnessMs`,
  `generationsPerHour`, per-pool `{fast,heavy}BusyMs`, `{fast,heavy}IdleMs`,
  `{fast,heavy}QueueMaxDepth`, `{fast,heavy}WaitMs`. Added
  `readonly throughput?` to `GenerationCompleteEvent` with extensive JSDoc
  documenting each field's meaning, units, and caveats (wait time is an
  approximation).
- **`src/workers/WorkerHandlerBase.ts`**: Added `busyStartMs` /
  `cumulativeBusyMs` private fields and `onTaskStart()`/`onTaskEnd()` hooks
  that capture clock reads only on idle↔busy transitions (0→1 start, N→0 end).
  Replaced raw `busyCount++/--` in `makePromise()`/`makePromiseDeferred()`
  with these hooks. Added public `getCumulativeBusyMs()`. Zero overhead in
  hot loops — a clock read per idle-busy boundary, not per task.
- **`src/multithreading/WorkerPool.ts`**: Added `getTotalBusyMs()` that sums
  `getCumulativeBusyMs()` across all workers in the pool.
- **`src/architecture/Fitness.ts`**: Added public `lastQueueMaxDepth`
  populated to `uniqueQueue.length` at fitness start — the true peak since
  the queue drains monotonically.
- **`src/breed/ParallelBreeding.ts`**: Added public `lastQueueMaxDepth`
  populated to `parentPairs.length` immediately after parent-pair selection.
- **`src/NEAT/ThroughputMetrics.ts`** (new): Pure helper module so the
  formulas can be unit-tested in isolation from `evolve()`:
  - `approximateWaitMs(busyMs, depth, workers)` — FIFO uniform-task-duration
    model: `wait ≈ busyMs × (depth - workers) / (2 × depth)`, zero when
    `depth ≤ workers` or any input is non-positive.
  - `computeIdleMs(wallClockMs, workers, busyMs)` — capacity minus busy,
    clamped to zero so clock-skew rounding cannot yield negatives.
  - `computeThroughputMetrics(input)` — assembles a finite, non-negative
    payload (clamps negative inputs, rounds wait, returns
    `generationsPerHour = 0` when `wallClockMs = 0`).
- **`src/NEAT/NeatEvolution.ts`**: Captures `fastBusyStartMs`/`heavyBusyStartMs`
  at generation start, samples `heavyQueueMaxDepth` from in-flight discovery
  and training sets (since heavy-pool work isn't a single-shot queue), builds
  the `GenerationThroughputMetrics` object via `computeThroughputMetrics()`,
  emits a `[Throughput]` verbose log line, and returns it alongside
  `phaseTiming` from `evolve()`.
- **`src/creature/CreatureTraining.ts`**: Forwards `result.throughput` into
  the `generation_complete` event payload.

### Design notes

- **Wait time is deliberately an approximation.** Exact per-task wait would
  require per-submission timestamps, which the issue explicitly rules out
  ("no per-creature logging in hot paths"). The FIFO uniform-task-duration
  model is transparent, cheap to compute, and signposted as approximate in
  JSDoc.
- **Queue depth is measured at the true peak.** Both hot paths enqueue all
  tasks before workers start draining them, so `queue.length` at creation
  time is the peak — no need to sample during execution.
- **Zero overhead on the per-task hot path.** Busy-ms accumulates via
  transitions on the existing `busyCount`, not via timestamps per task.

## Evidence

Backend/telemetry change with no UI. Evidence is provided via the test
results below and the `[Throughput]` verbose log line emitted per generation.

## Test Plan

- Added `test/NEAT/ThroughputMetrics.ts` (11 unit tests on the pure helpers):
  - `approximateWaitMs` returns zero for non-positive inputs and when
    `depth ≤ workers`
  - FIFO formula: `busyMs=1000, depth=10, workers=2 → 400`
  - Monotonicity with queue depth
  - `computeIdleMs` capacity calculation and clamping on busy > capacity
  - `computeThroughputMetrics` full payload, zero wall-clock yields
    `generationsPerHour = 0` (finite), negative input clamping,
    `fitnessMs > totalMs` yields `nonFitnessMs = 0`
- Added `test/config/ThroughputMetrics.ts` (10 integration tests via
  `Creature.evolveDataSet` with `onTrainingEvent`):
  - `throughput` is present on every `generation_complete` event
  - All 11 fields are finite non-negative numbers
  - `wallClockMs === phaseTiming.totalMs`
  - `nonFitnessMs === max(0, totalMs - fitnessMs)`
  - `generationsPerHour === 3_600_000 / wallClockMs` (when wallClock > 0)
  - `fastQueueMaxDepth ≥ 1` and `≤ population size` on fitness path
  - Heavy-pool fields present even when heavy-pool is idle
- Full quality gate passes: `./quality.sh --skip-discovery --skip-wasm`
  reports `5922 passed | 0 failed | 3 ignored`.
