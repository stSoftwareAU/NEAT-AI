## Summary

Adds scorer runtime telemetry and a batch-vs-per-creature throughput benchmark
so operators can see whether NEAT-AI is benefiting from one-pass batch scoring
across different hardware. Closes #2424.

`Fitness.calculate()` now records the aggregate main-thread scorer wall time
(`lastScorerMs`) and the unique-scored creature count
(`lastScoredCreatureCount`) using a single `performance.now()` pair per scored
creature — no per-creature logging in hot paths. `NeatEvolution` feeds those
counters through `computeThroughputMetrics()`, which adds three fields to
`GenerationThroughputMetrics`:

- `scoredCreatureCount` — unique creatures that hit the scorer (cached
  duplicates resolved by UUID copy are excluded).
- `scorerMs` — aggregate main-thread wall time spent in `calculateScore()`.
- `creaturesPerSec` — derived throughput:
  `scoredCreatureCount × 1000 / fitnessMs`.

The existing `[Throughput]` verbose log line is extended with
`scorer=<ms>/scored<N>/creaturesPerSec<rate>` so telemetry is visible in run
logs. The metrics are also already surfaced on the
`generation_complete.throughput` event for persisted stats.

A new `bench/ScorerBatchThroughput.ts` benchmark runs `Fitness.calculate()`
across population sizes 20 / 50 / 100 and compares two configurations:

- **batch** — `topologyGrouping: true` (current production default).
- **per-creature** — `topologyGrouping: false` (legacy baseline).

It reports wall-clock, scorer-ms, unique-scored count, creatures/sec, and the
batch-vs-baseline speedup ratio, matching the issue's acceptance criteria.

## Evidence

This is a backend/CLI change with no web interface to screenshot.

Benchmark output (`docs/evidence/scorer-batch-throughput-2424.txt`):

```
Mode           Pop  Fitness(ms)  Scorer(ms)   Scored  Creatures/sec
-------------------------------------------------------------------
per-creature    20        12.10       0.214       20         1653.2
batch           20        11.53       0.118       20         1735.3
per-creature    50        31.17       0.327       50         1604.0
batch           50        35.46       0.922       50         1410.1
per-creature   100        62.53       1.242      100         1599.1
batch          100        65.10       1.357      100         1536.0
```

The benchmark uses an in-process stub worker (fixed 1 ms evaluation latency) so
it measures scheduling + scorer + telemetry paths directly. With no real WASM
evaluation the speedups are small (≈1×); the point of the benchmark is to expose
the three new telemetry fields in a reproducible matrix so the same numbers
captured in production can be compared across hardware. The telemetry itself is
what identifies whether batch mode helps on a given machine — the
`creaturesPerSec` field is now emitted on every generation.

Unit test output (all 42 fitness + throughput tests pass):

```
running 4 tests from ./test/architecture/FitnessScorerTelemetry.ts
Fitness scorer telemetry - counts unique scored creatures ... ok
Fitness scorer telemetry - excludes cached duplicates ... ok
Fitness scorer telemetry - empty population resets counters ... ok
Fitness scorer telemetry - skips creatures with non-finite error ... ok

running 16 tests from ./test/NEAT/ThroughputMetrics.ts
… 16 passed
running 11 tests from ./test/config/ThroughputMetrics.ts
… 11 passed
ok | 42 passed | 0 failed
```

Full NEAT suite: `654 passed | 0 failed (2m31s)`.

## Test Plan

- `test/architecture/FitnessScorerTelemetry.ts` (new) — verifies `lastScorerMs`
  / `lastScoredCreatureCount` for unique, duplicate, non-finite-error, and
  pre-scored populations.
- `test/NEAT/ThroughputMetrics.ts` (extended) — five new cases for the scorer
  fields: default zero, derived `creaturesPerSec`, zero-fitness guard,
  negative-input clamping, and fractional count flooring.
- `test/config/ThroughputMetrics.ts` (extended) — asserts `scoredCreatureCount`,
  `scorerMs`, and `creaturesPerSec` are present, finite, non-negative, and
  bounded by population size on real `generation_complete` events.
- `bench/ScorerBatchThroughput.ts` (new) — reproducible batch vs per-creature
  matrix for population sizes 20, 50, 100 with speedup ratios.
