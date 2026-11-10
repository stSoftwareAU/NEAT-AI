## Summary

Second step for #4146 (the first, #4149, wrote one `[training-backend]` line per
task and relayed it to the parent log). A native (`ffi` or `cli`) training task
now also writes two `[training-phase]` lines through the same worker relay:

```text
[training-phase] task=<ID> phase=<native-returned|finalised> timedOut=<yes|no|unknown> msFromDeadline=<integer|none>
```

`native-returned` is written as soon as the blocking native call returns, and
`finalised` when packaging and compaction finish. After the next field run on
sloth@GRQ-3, the parent log therefore separates the three inferred branches: a
`[training-backend]` line with no `native-returned` line means the task was
still inside the native call (branches 1 and 2); `native-returned` without
`finalised` means it hung in finalisation (compaction/validation of the 9,684
neuron creature, branch 3). The root cause itself is still not pinned or fixed:
it needs a log from a run that carries these lines, or the captured creature.

Part of #4146.

Version bump: not touched by this change.

## Spec

### Intent and Rationale

- The engine's own source (`backpropagation/src/train.rs`, checked on its
  `Develop`) says the deadline is read before every accumulated record, so "only
  checked between epochs" is doubtful. A hang after the native call returns,
  inside TypeScript finalisation (`compactUnused`, `compactVariants`,
  validation), is equally consistent with a held worker, `timedOut=0` and a
  "thread blocked in native code" teardown line (WASM). The phase lines make
  that distinguishable without guessing.

### Essential Design Decisions

- The lines reuse the #4146 reporter hook, so they reach the parent from a
  pooled worker exactly as the backend line does. The `[training-phase]` prefix
  is distinct, so the one-backend-line-per-task contract is unchanged.
- `msFromDeadline` is wall-clock now minus the task deadline, read through the
  existing `finalisationNow` seam.
- A native call that throws writes no phase line; the task fails with its error.

### Undiscoverable Facts

- The WASM loop never reaches `packageTrainingResult`, so it writes no phase
  lines.
- `./quality.sh` cannot run its test stage on this host (no native
  `rust_scorer`); `./quality.sh --skip-tests --skip-discovery` passes (format,
  lint, type check, WASM sync).

## Evidence

Tests: `test/architecture/training/RustTrainDirBackendReport.ts`.

## Reproduction

- **symptom** — training tasks overran the per-task deadline, returned no result
  and were quarantined; the log could not say where the task was held
- **status** — `not-run` — reason: the hang needs the captured creature
  (`~/logs/training-hangs/*.json` on sloth@GRQ-3) and the deployed engine;
  neither is reachable from this run. Only observability was extended.
- **regression test** — none for the hang itself; the phase-line tests are
  listed in the Test Plan

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **met** — The worker logs, into the parent run log, which `trainDir` backend
  ran and whether a deadline was forwarded (one line per task:
  `backend=ffi|cli|wasm deadlineSent=yes|no capability=<version|none>`). A
  regression test asserts the line reaches the parent's logger from inside a
  worker. — evidence: `test/workers/TrainDirBackendRelay.ts`,
  `test/workers/TrainDirBackendRelayWiring.ts`,
  `test/architecture/training/RustTrainDirBackendReport.ts` (delivered by #4149)
  — reviewer: met
- **missing** — Root cause pinned to one of the three branches above with a
  reproduction on the captured creature or an equivalently large fixture. —
  reviewer: missing — reason: needs the captured creature or a field log that
  carries the phase lines; the engine source does not support branch 1 as worded
- **missing** — If branch 1: the engine checks the deadline inside an epoch (or
  at a bounded batch interval) — coordinate with NEAT-AI-Backpropagation#214.
  Regression: a fixture where one epoch is longer than the deadline returns
  `timedOut: true` with changed weights within deadline + 30 s through both FFI
  and CLI. — reviewer: missing — reason: conditional on branch 1, still
  unconfirmed
- **missing** — If branch 2: capability probe failure is loud and the regression
  covers the `$CARGO_HOME/lib` install layout GRQ uses. — reviewer: missing —
  reason: branch 2 is unconfirmed; the `~/.cargo/lib` layout test came with
  #4149
- **missing** — Closing requires a quoted
  `[training-outcomes] … timedOut=N≥1 abandoned=0` line from a sampler or learn
  run on sloth@GRQ-3 (or another 16 GB host) on the fixed release, not
  inspection. — reviewer: missing — reason: needs a host run on a released build

- **unrequested** — the `[training-phase]` lines, their tests and docs —
  reviewer: unrequested — reason: not named by a criterion; added so the next
  field log can pin the root cause the second criterion asks for

## Test Plan

All in `test/architecture/training/RustTrainDirBackendReport.ts`; run on the
head with the two relay tests: `deno test -A` on
`test/architecture/training/RustTrainDirBackendReport.ts`,
`test/workers/TrainDirBackendRelay.ts` and
`test/workers/TrainDirBackendRelayWiring.ts` — 20 passed, 0 failed.
`./quality.sh --skip-tests --skip-discovery` passed; the full gate stops at the
missing native `rust_scorer` on this host.

- Literal phase-line format, including `timedOut=unknown`.
- Completed FFI run (`msFromDeadline=-5000`), with the exact order backend line,
  native call, `native-returned`, `finalised`.
- Timed-out FFI run (`timedOut=yes msFromDeadline=7000`).
- No-deadline FFI run and CLI run (`msFromDeadline=none`).
- Legacy FFI run: `native-returned timedOut=unknown`, `finalised timedOut=no`.
- Unparseable response: `native-returned` written, no `finalised`, error
  propagates (pins that `native-returned` is written before parsing).
- Throwing native call: no phase line, error propagates.

Red-checks: removing the three phase-report calls turned 6 tests red (the
absence test stays green by design); moving `native-returned` back into
`packageTrainingResult` turned the unparseable-response and legacy tests red.
Only the no-deadline CLI test asserts phase lines on the CLI path; the other CLI
tests use a real-clock deadline, so their `msFromDeadline` is not deterministic.
