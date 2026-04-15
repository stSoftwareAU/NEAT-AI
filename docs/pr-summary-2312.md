## Summary

Add per-phase worker utilisation metrics to the evolution loop diagnostics. This instruments each evolution phase to capture how many workers are active vs idle, providing the data needed to understand why production CPUs average only ~20% usage and to prioritise concurrency improvements. Closes #2312.

### Changes

1. **`WorkerPool.getActiveWorkerCount()`** — New method that returns the count of currently busy workers. Consistent with `getStats().busyWorkers` but cheaper for snapshot-only use.

2. **`WorkerUtilisationSnapshot` / `PhaseWorkerUtilisation` interfaces** — New types in `TrainingEvent.ts` that capture fast-pool and heavy-pool active/total counts and utilisation percentages per phase.

3. **`GenerationPhaseTiming.workerUtilisation`** — New optional field on the existing phase timing interface. Contains per-phase snapshots (fitness, breeding, sort, writeScores, speciation, mutation, deduplication, preWarm) plus an overall weighted CPU utilisation estimate.

4. **`NeatEvolution.ts` instrumentation** — Captures a utilisation snapshot at the end of each phase using `captureUtilisationSnapshot()`, and computes overall CPU utilisation via `computeOverallCpuUtilisation()` weighted by phase duration. Verbose mode logs a one-line utilisation summary.

5. **Production-scale benchmark** (`bench/WorkerUtilisationProfile.ts`) — Runs 5+ generations at medium (30 neurons) and large (80 neurons) scales, validates utilisation data is captured, and includes a `--report` mode for standalone analysis.

## Evidence

This is a backend instrumentation change with no UI. Evidence is provided by the test suite:

- 5 new tests in `test/config/WorkerUtilisationDiagnostics.ts` verify the utilisation fields are present, structurally valid, and within expected ranges
- 4 new tests in `test/multithreading/WorkerPool.ts` verify `getActiveWorkerCount()` correctness
- All 5863 existing tests continue to pass
- `quality.sh` passes cleanly

## Test Plan

- `test/multithreading/WorkerPool.ts` — Tests for `getActiveWorkerCount()`: count of busy workers, zero when idle, total when all busy, consistency with `getStats()`
- `test/config/WorkerUtilisationDiagnostics.ts` — Integration tests verifying:
  - `workerUtilisation` field is present in generation events
  - Snapshot structure has all required fields with correct types
  - All core phases have snapshots populated
  - `overallCpuUtilisationPct` is a valid percentage (0–100)
  - Single-thread mode reports correct totals (active ≤ total)
- `bench/WorkerUtilisationProfile.ts` — Benchmark validates utilisation data capture at medium and large scales
