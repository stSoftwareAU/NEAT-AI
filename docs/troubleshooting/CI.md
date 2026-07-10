# 🔄 CI / quality.sh Troubleshooting

This document covers CI (Continuous Integration) and local quality-gate
failures: the `coverage.yaml` workflow's shard matrix + per-shard retry
strategy, exit-code meanings, and `quality.sh` step-by-step. See the index in
[`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) for other categories.

## 📋 Understanding coverage.yaml

The CI workflow (`coverage.yaml`) runs the ~1k-file suite as a **parallel shard
matrix** to cut wall-clock time (Issue #3173). `deno test` has no native
`--shard` flag, so
[`scripts/shard_test_files.ts`](../../scripts/shard_test_files.ts) partitions
the sorted `test/**/*.ts` list round-robin across `SHARD_TOTAL` shards — shard
`s` runs every file whose sorted index `i` satisfies `i % SHARD_TOTAL === s`, so
every file runs on exactly one shard (no gaps, no double-runs).

```mermaid
flowchart LR
    subgraph coverage["coverage job (matrix, fail-fast: false)"]
        S0["shard 0<br/>slice → .coverage-0 + junit-0.xml"]
        S1["shard 1<br/>slice → .coverage-1 + junit-1.xml"]
        SN["shard N-1<br/>slice → .coverage-N-1 + junit-N-1.xml"]
    end
    S0 --> M
    S1 --> M
    SN --> M
    subgraph merge["merge job (needs: coverage, if: !cancelled)"]
        M["Verify parity → merge .coverage-* (lcov)<br/>+ merge junit-*.xml → gate on shard statuses"]
    end
    M --> C["1 Codecov coverage report<br/>1 consolidated Test Results check"]
```

**Per shard:** each matrix job sizes the V8 heap / parallelism to the runner,
runs its slice, and — if the runner OOM-kills the run — retries once while
**staying parallel**: it keeps `--parallel` but caps the worker pool via
`DENO_JOBS=2` and halves the V8 heap (Issue #3174). Each shard uploads its
partial `.coverage-<shard>` dir, `junit-<shard>.xml`, and a
`shard-status-<shard>.txt` marker; test _failures_ never fail the shard job (the
merge job gates the build), so every shard always publishes its results.

Both the initial plan and the scoped OOM recovery come from the unit-tested
[`scripts/coverage_run_plan.ts`](../../scripts/coverage_run_plan.ts)
(`planInitialRun` / `planOomRetry`), so the workflow has a single source of
truth for heap size, worker cap, and the `--parallel` flag.

Resource allocation on the first attempt:

- 8+ cores and 8+ GB RAM: 70% memory, parallel enabled
- 4+ cores and 4+ GB RAM: 60% memory, parallel enabled
- Under 4 cores or 4 GB: 50% memory, no parallelism

### 🧠 Why the OOM recovery stays parallel (Issue #3174)

> [!IMPORTANT]
> A coverage-shard OOM is **concurrency-driven, not a single leaky file**. Do
> **not** re-propose a single-threaded / serial re-run as the fix — it was tried
> and deliberately abandoned. See below.

An earlier design reacted to a shard OOM by re-running the **whole slice
single-threaded** — it dropped `--parallel` entirely and only halved the heap.
On a memory-heavy shard that serial re-run blew the 60-minute job timeout,
defeating the point of the parallel suite, so #3174 **reverted** it.

The root cause is that no single test file is a runaway leak — each of the
heaviest peaks in the ~120–210 MB range (measured with
`/usr/bin/time -l deno test -A --v8-flags=--expose-gc <file>`). Under
`--parallel`, `DENO_JOBS` (≈ CPU count) workers each hold a slice of that heap
at once, so peak concurrent memory is roughly `workers × per-file heap` plus the
shared WASM activation/compilation caches. On the 4-core CI runner the default 4
workers multiply the per-file footprint enough to trip the OOM killer on the
heaviest shards.

That is why the correct lever is the **worker count**, not a hunt for one leaky
file:

- Halving the heap alone (the original behaviour) leaves the same number of
  workers competing for less memory — it does not cut peak concurrent heap.
- Dropping to serial fixes memory but destroys throughput and blows the job
  timeout — the abandoned approach.
- Capping `DENO_JOBS=2` on the recovery lowers peak concurrent heap **and**
  keeps the run parallel, so the safety net stays fast.

A run that was already serial (a genuinely tiny runner, < 4 cores / < 4 GB)
stays serial on the retry with the reduced heap.

```mermaid
flowchart TD
    A[Shard slice] --> B["Initial run<br/>--parallel, DENO_JOBS=auto, full heap"]
    B --> C{Exit code}
    C -->|"0 / 1"| E["Record status<br/>upload .coverage-N + junit-N.xml"]
    C -->|"134 / 137 / 143 (OOM)"| D["Scoped recovery<br/>--parallel, DENO_JOBS=2, half heap"]
    D --> E
    E --> M["Merge job<br/>merge coverage + JUnit, gate on shard statuses"]
```

**Merge job:** re-verifies partition parity, merges the partial coverage dirs
into one `.coverage.lcov` via `deno coverage`, merges the per-shard JUnit
reports into a single `junit.xml` via
[`scripts/merge_junit.ts`](../../scripts/merge_junit.ts), publishes one
consolidated Test Results check + Codecov upload, then fails the build if any
shard reported test failures (`failed`) or a runner crash (`error`/missing
status).

**Per-shard exit code meanings:**

| Exit Code   | Meaning           | Shard Action                                               |
| ----------- | ----------------- | ---------------------------------------------------------- |
| 0           | All tests passed  | Marker `passed`                                            |
| 1           | Test failures     | Marker `failed`; merge job fails build                     |
| 143/137/134 | OOM kill / signal | Retry once, still parallel: cap `DENO_JOBS=2` + halve heap |
| Other       | Unexpected error  | Marker `error`; merge job fails build                      |

**Tuning shard count:** set the workflow-level `SHARD_TOTAL` env **and** the
`coverage` job's `strategy.matrix.shard` list to the same value —
`test/ci/CoverageShardMatrix.ts` fails CI if they diverge.

## 🔧 quality.sh failures

The `quality.sh` script runs these steps in order:

1. `deno outdated --update --latest` — Update dependencies
2. `deno fmt` — Format code
3. `deno lint --fix` — Lint with auto-fix
4. Bash syntax check — Validates `.sh` files
5. `deno check` — Type-check
6. Discovery library check — Builds/validates the optional Rust discovery
   library
7. `./build.sh --verify-only` — Sync `wasm_activation/pkg` from the pinned
   NEAT-AI-core (verify-only; CI never auto-advances `neatCore.rev`)
8. `deno test` — Run all tests with leak detection

If discovery checks fail with exit codes 137 or 9 (segfault), the script
provides diagnostic guidance. See
[Discovery troubleshooting → Architecture mismatch](DISCOVERY.md#-architecture-mismatch-errors-arm64-vs-x86).

## See also

- [Memory troubleshooting](MEMORY.md) — for the OOM retry logic referenced
  above.
- [Discovery troubleshooting](DISCOVERY.md) — segfault / exit-code-137 diagnosis
  when the discovery library is broken.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — full quality-gate workflow
  for contributors.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
