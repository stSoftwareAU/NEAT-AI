## Summary

Recorded a fresh downstream log archive search and the strongest retained field
evidence in `docs/TIMEOUTS.md`. The heartbeat and stall diagnostics are already
present on the base from merged PRs #4101 and #4136. This investigation did not
identify the generation-11 cause or find qualifying closing evidence, so it
remains part of #4096.

Version bump: `VERSION` is not changed by this investigation; the merged commit
records the final version.

## Spec

### Intent and Rationale

- Refresh the field evidence against the current downstream log archive snapshot
  and keep measured observations separate from the illustrative breach example.
- Avoid changing production behaviour without reproducing a watchdog or
  diagnostic defect.

### Essential Design Decisions

- The 7.1.2 field run excludes mutation only for its own generation-2 stall. Its
  phase and host measurements cannot establish the cause of the separate
  generation-11 incident.
- The current downstream log archive snapshot has no qualifying breach or
  swap-backed 8 GB final-loop evidence. The issue remains open for a deployed
  run carrying the diagnostics.

### Undiscoverable Facts

- The current environment has 16 GB RAM and no swap, so it cannot reproduce the
  reported 8 GB swap-backed host condition.
- The downstream log archive's `Develop` at
  `ef0dd4e255c7702b53ccad8e61b4d19b332e85f8` was the latest source snapshot
  rechecked on 2026-11-06.

## Evidence

The initial downstream log archive `Develop` snapshot inspected was
`92bd6423ba6c37adc471557368368c23d3ce4c4e`. This turn rechecked all five tracked
log files at the newer snapshot `ef0dd4e255c7702b53ccad8e61b4d19b332e85f8`:
`GRQ-25-elephant-degraded.log`, `GRQ-25-elephant.log`, `GRQ-3-scorer.log`,
`Mac-Ultra-M2-elephant.log` and `Mac-Ultra-M2-portfolio.log`. None contains
`lastHeartbeatAgeMs`, `main loop stalled` or `Run wedged`, and none provides a
green final loop on a swap-backed 8 GB host. The only `neat-ai` release marker
was 7.1.3 in `GRQ-3-scorer.log`, which is not a learning run with these
diagnostics. The original host and full corpus are unavailable here.

One useful older learning-run log retrieved from repository history is
`GRQ-3-rocket.log` from downstream log archive source commit
`289753f0c5459c30f261794ae91e151c77ff43b7`. It records GRQ 1.1.213 (`13c24754`),
NEAT-AI 7.1.2, generation 2 on rocket@GRQ-3: 10 CPUs, 16 GB RAM, about 8 GB
available and load averages `49.79 58.48 50.43`.

```text
[Timing] fitness=34710ms breeding=133950ms breedingWorker=133949ms mainThreadOverlap=0ms resultProcessing=0ms memoryEviction=3ms preWarm=508ms pipelineOverlap=526ms sort=0ms writeScores=194ms mutation=0ms deduplication=974ms speciation=18ms total=232627ms
[DiscoveryReplayRunner] Worker init failed; falling back to direct execution for this worker slot. Error: [WasmWorkerInit] Worker init: no response after 60s (worker=worker-25). Parent-observed: handshakeMs=60000 parentStallMs=5942 loopBlockedMs=64941 spawnToInitMs=0 workerError=none heartbeat=none wasm[cache=hit cacheDir=/Users/rocket/.cache/neat-ai/wasm bundleBytes=1039068 bundleLoadMs=24 glueImportMs=30 instantiateMs=6 wasmTotalMs=61].
```

This supports excluding mutation for this instance (`mutation=0ms`), while the
64,941 ms parent block remains unattributed. It does not distinguish paging from
CPU starvation or establish whether work inside fitness caused the generation-11
stall. RSS, page faults, swap activity and GC traces were not recorded in this
log. This run predates non-fatal stall reporting, and contains no watchdog
heartbeat-age reading. The shared-memory heartbeat and fatal-breach fields were
already present: commit `c3733691` (#4101) declares NEAT-AI 7.0.64. This field
excerpt is distinct from the illustrative breach line in `docs/TIMEOUTS.md`.

The checked-out host reports 16 GB RAM and `SwapTotal: 0 kB`, so a local
memory-pressure run would not reproduce the reported host condition. No
production defect was demonstrated; no code was changed.

## Reproduction

- **symptom** — the reported generation-11 main-loop stall and SIGKILL were not
  reproduced. The existing subprocess tests reproduce the narrower diagnostic
  case of a generation-2 busy loop and a yielding run.
- **status** — `partial` — reason: the original 8 GB swap-backed host and full
  corpus are unavailable, so the generation-11 failure was not reproduced;
  existing diagnostic tests pass, with no fail-before observation this turn.
- **regression test** —
  `test/creature/EvolveRunWatchdogHeartbeat_test.ts::EvolveRunWatchdogHeartbeat: a busy main thread in generation 2 is killed with a heartbeat age at least the busy duration`

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **met** — The watchdog gets a main-thread heartbeat: a `SharedArrayBuffer`
  timestamp the main loop bumps on a timer, read by `EventLoopWatchdogWorker`.
  The breach line then reports `lastHeartbeatAgeMs=` and the in-flight phase
  (`inFlightPhase`). — evidence: `src/NEAT/EventLoopWatchdog.ts`,
  `src/NEAT/EventLoopWatchdogWorker.ts` on the base from #4101 — reviewer: met
- **partial** — Root cause of the generation-11 stall identified, or reproduced
  or excluded with quoted evidence. In particular: is it paging on a swap-backed
  heap, or main-thread work inside fitness? — evidence: the generation-2
  `GRQ-3-rocket.log` excerpt above — reviewer: partial — reason: mutation is
  excluded for this different instance only; its log has no watchdog
  heartbeat-age reading, RSS, page-fault, swap or GC measurements, so
  generation-11 cause and paging versus main-thread work inside fitness remain
  unresolved
- **met** — Regression test: a subprocess run whose main thread busy-loops in
  generation ≥ 2 is killed with a breach line carrying `lastHeartbeatAgeMs` ≥
  the busy duration. A run that is merely slow but yielding reports a small
  heartbeat age. — evidence: `test/creature/EvolveRunWatchdogHeartbeat_test.ts`
  (both subprocess tests reran this turn; 57 targeted tests passed) — reviewer:
  met
- **missing** — Closing evidence: a quoted breach line from a field run that
  includes the heartbeat age, or a quoted green final loop on a swap-backed 8 GB
  host. — reviewer: missing — reason: all five logs at the latest downstream log
  archive snapshot lack qualifying field evidence; this environment has no swap
  and cannot supply a matching host run

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

- **violation** — documentation claims must match implementation and history
  (`docs/DOC_STYLE.md`, rule 4) — evidence: `docs/TIMEOUTS.md` field observation
  — reason: fixed in this diff by distinguishing the existing heartbeat from
  later non-fatal stall reporting
- **clean** — documentation-only scope, Australian English, NEAT-AI terminology,
  separation of measured field evidence from the illustrative breach, and
  explicit limits on reproduction and acceptance. No `CODING-STANDARDS.md`
  exists; the reviewer checked `AGENTS.md`, `docs/ENGINEERING_PRINCIPLES.md` and
  `docs/DOC_STYLE.md`.

## Test Plan

- The archive privacy gate checks that this summary uses publicly readable
  descriptions of the downstream log archive.
- Existing watchdog, phase-observer and entry-point tests:
  `deno test -A test/NEAT/EventLoopWatchdog_test.ts
  test/NEAT/NeatPhaseObserver_test.ts
  test/creature/EvolveRunWatchdogHeartbeat_test.ts
  test/creature/EvolveRunWatchdog_test.ts
  test/creature/EvolveWatchdogWiring_test.ts < /dev/null`
  — reran this turn: 57 passed, 0 failed.
- This documentation correction: `./quality.sh --lint-only < /dev/null` passed
  dependency checks, formatting, linting and bash checks. Both edited documents
  also pass `deno fmt --check`; `git diff --check` passes. Final Spec review
  confirmed met / partial / met / missing; final Standards review was clean.
- `timeout 900 ./quality.sh --rust-scorer-bin=/var/tmp/vibe-cargo-target/NEAT-AI-a155970c/release/rust_scorer < /dev/null`
  — passed earlier in this run, 10,260 passed, 49 ignored. Discovery library
  verification was skipped because the sibling `NEAT-AI-Discovery` checkout and
  library are absent.
- The first `./quality.sh` attempt failed because `rust_scorer` was not on
  `PATH` or in the expected sibling `target` directory. Built the scorer through
  the quality gate, then reran with its actual `CARGO_TARGET_DIR` binary path as
  shown above.
- No test assertions were edited or removed. No tests were added.
