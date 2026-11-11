## Summary

Third step for #4146. #4149 made each training task write one
`[training-backend]` line, and #4150 added `[training-phase]` lines, both
relayed to the parent log. This step narrows the root cause with measurements on
a creature about the size of the one in the issue, and commits a bench so the
finalisation measurement can be repeated
(`bench/TrainingFinalisationLargeCreature.ts`). No production code changes.

The finding: with the engine the host runs (`NEAT-AI-Backpropagation` `947cbb5`,
v0.1.50, rebuilt from source on this host), the native trainer **does** honour
the deadline on a creature of this size, and the TypeScript finalisation that
follows takes well under a second. Neither of the two stages the issue's branch
1 and the finalisation hypothesis point at can hold a worker for minutes. The
hold has to come from somewhere the log cannot yet show, and the `[training-*]`
lines from #4149/#4150 are what will show it on the next sloth@GRQ-3 run on a
release that carries them (7.1.14, the latest field report, predates them).
Branch 2 (capability probe) and branch 3 (task never reached `trainDir`) stay
open. The issue is not closed by this step.

Part of #4146.

Version bump: `deno.json` was auto-incremented to 7.1.17 by CI (commit ebf33d4f); the merged commit records the final version.

## Spec

### Intent and Rationale

- The log cannot say whether a task sat in the native call, in finalisation, or
  never reached `trainDir`. Before waiting for a field log, rule out what can be
  ruled out offline: run the real engine and the real finalisation code on a
  fixture of the reported size.

### Essential Design Decisions

- The bench lives in `bench/` (timing is not allowed in `test/`, per AGENTS.md)
  and asserts nothing; it only reports `Deno.bench` timings.
- No production change: the offline measurements do not reproduce a fault, and a
  fault that has not been reproduced is not fixed on a guess.

### Undiscoverable Facts

- The engine and FFI measurements were taken in uncommitted scratch scripts
  under `/tmp` (a generator for the fixture, a CLI run, and an FFI run through
  `nativeBackpropTrain`); only the finalisation stage is in the committed bench.
  Commands and output are quoted under Evidence.
- The captured creatures (`~/logs/training-hangs/*.json` on sloth@GRQ-3) are not
  reachable from this host.

## Evidence

Engine fixture (an uncommitted scratch generator under `/tmp`, not the committed
builder): 50 inputs, 5 outputs, 9,630 hidden neurons, 64,992 synapses
(forward-only, `TANH`, seeded), plus a 200,000-record `.bin` corpus (44 MB).
Host: 21 cores, linux. Engine built with
`cargo build --release --locked -p neat_ai_backpropagation` at `947cbb5`.

Native engine, deadline 40 s ahead, CLI:

```text
neat_ai_backpropagation train creature.json data --epochs 2 --output-dir out1 --seed 1 --deadline-epoch-ms <now+40000>
real 0m40.109s
```

The run stopped 109 ms past the deadline. (The fixture's synapse order was not
canonical, so the engine rejected the finished creature at the end; the deadline
timing is unaffected.)

Native engine, FFI through the repository's own `nativeBackpropTrain`
(`NEAT_AI_BACKPROP_LIB_PATH` pointing at the rebuilt library; the capability
probe reported `deadlineEpochMs`, version 1):

```text
deadline 40000 ms: returned after ms past deadline: 304
  timedOut: true, phase: accumulation, weightsChanged: true, best: partial (256 records)
deadline 8000 ms:  returned after ms past deadline: 294
  timedOut: true, completed: 0
```

So an epoch that is longer than the deadline returns `timedOut: true` with
changed weights about 0.3 s past the deadline, through both the CLI and FFI.
This is a measurement on this fixture; it does not cover the production corpus
or a 16 GB macOS host.

TypeScript finalisation on a creature of the issue's size (50 inputs, 5 outputs,
9,629 hidden neurons = 9,684 neurons, 63,317 synapses), from the committed bench
(`deno bench --allow-read --allow-write --allow-env --allow-ffi
bench/TrainingFinalisationLargeCreature.ts`,
average per iteration, re-run on the final head on a shared 7-core aarch64 Linux
host, so indicative only):

| stage                           | time     |
| ------------------------------- | -------- |
| `Creature.fromJSON`             | 34.0 ms  |
| `creature.loadFrom(exportJSON)` | 35.6 ms  |
| `creature.exportJSON()`         | 5.6 ms   |
| `creature.traceJSON()`          | 8.9 ms   |
| `compactUnused(trace, 0.1)`     | 198.8 ms |

Limit of that table: the trace comes from a never-activated creature, so
`compactUnused` times the copy and identity setup, not a removal pass over a
trained creature.

Code read: the engine's `run_train_until` reads the deadline at entry, before
every baseline batch, every accumulated record and every candidate batch
(`backpropagation/src/train.rs`, doc comment on `run_train_until`); the
record-sample planning that runs before the first check only opens each corpus
file's header and counts records (`sampling.rs`, `plan_record_sample`).

```mermaid
flowchart LR
    A[task dispatched] --> B[buildTrainRequestFields]
    B --> C{backend}
    C -->|ffi / cli| D[native train + deadline]
    C -->|wasm| W[TS loop]
    D -->|measured: stops ~0.1-0.3 s past deadline| E[packageTrainingResult]
    E -->|measured: well under 1 s| F[result to parent]
    D -.->|[training-phase] native-returned| L[parent log]
    E -.->|[training-phase] finalised| L
```

## Reproduction

- **symptom** — training tasks overran the per-task deadline, returned no result
  and were quarantined (held 342–435 s on sloth@GRQ-3)
- **status** — `not-run` — reason: the production hang needs the captured
  creature and corpus on a 16 GB macOS host; a fixture of the reported size with
  the same engine returned within 0.3 s of its deadline, so the field fault did
  not reproduce here. No fix is shipped on that basis.
- **regression test** — none; no fault was reproduced

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **met** — The worker logs, into the parent run log, which `trainDir` backend
  ran and whether a deadline was forwarded (one line per task:
  `backend=ffi|cli|wasm deadlineSent=yes|no capability=<version|none>`). A
  regression test asserts the line reaches the parent's logger from inside a
  worker. — evidence: `test/workers/TrainDirBackendRelay.ts`,
  `test/workers/TrainDirBackendRelayWiring.ts`,
  `test/architecture/training/RustTrainDirBackendReport.ts` (delivered by the
  merged #4149, not by this diff) — reviewer: missing — reason: the reviewer saw
  only this diff, which adds the bench and its large-creature fixture; the
  criterion is satisfied by #4149 already on the base branch
- **partial** — Root cause pinned to one of the three branches above with a
  reproduction on the captured creature or an equivalently large fixture. —
  evidence: `bench/TrainingFinalisationLargeCreature.ts` and the measurements
  under Evidence — reviewer: missing — reason: an equivalently large fixture
  shows branch 1 (engine checks the deadline too rarely) and slow TS
  finalisation do not reproduce, but branches 2 and 3 are not ruled out and no
  hang was reproduced; the reviewer's note that the fixture is only about the
  reported size is accepted
- **missing** — If branch 1: the engine checks the deadline inside an epoch (or
  at a bounded batch interval) — coordinate with NEAT-AI-Backpropagation#214.
  Regression: a fixture where one epoch is longer than the deadline returns
  `timedOut: true` with changed weights within deadline + 30 s through both FFI
  and CLI. — reviewer: missing — reason: conditional on branch 1, which the
  measurements do not support (CLI 109 ms and FFI 294–304 ms past the deadline);
  the engine already checks per record
- **missing** — If branch 2: capability probe failure is loud and the regression
  covers the `$CARGO_HOME/lib` install layout GRQ uses. — reviewer: missing —
  reason: branch 2 is unconfirmed; the `~/.cargo/lib` layout test came with
  #4149
- **missing** — Closing requires a quoted
  `[training-outcomes] … timedOut=N≥1 abandoned=0` line from a sampler or learn
  run on sloth@GRQ-3 (or another 16 GB host) on the fixed release, not
  inspection. — reviewer: missing — reason: needs a host run on a released build
- **unrequested** — `bench/TrainingFinalisationLargeCreature.ts` — reviewer:
  unrequested — reason: not named by a criterion; it records the finalisation
  measurement that narrows the root cause the second criterion asks for, and
  changes no behaviour

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

- **clean** — no violations reported. The repository has no
  `CODING-STANDARDS.md`, so the reviewer used `AGENTS.md` and
  `docs/ENGINEERING_PRINCIPLES.md`: the file is in `bench/` (timing allowed,
  `Deno.bench` only), Australian English, no `console.*`, UUID-only fixture,
  `loadFrom(json, false)` matches the signature at `src/Creature.ts`, no
  workflow files or named-but-absent tests

## Test Plan

- Added `bench/TrainingFinalisationLargeCreature.ts` (a `Deno.bench` file, no
  assertions). Run on the final head: all five cases ran, results in the
  Evidence table.
- Moved the fixture builder out of the bench into
  `test/fixtures/LargeCreatureFixture.ts` (parameterised by a shape) and added
  `test/fixtures/LargeCreatureFixture.test.ts` (6 tests at head). The shape now
  builds exactly the issue's totals: 50 inputs + 5 outputs + 9,629 hidden =
  9,684 neurons, and 63,317 synapses (the outward-connection fix-up runs before
  the random fill, so the synapse count lands on the target). The first test
  builds `ISSUE_4146_SHAPE` and asserts those two totals as literals; the others
  pin, on a small shape: neuron counts, uuids, biases and squash; forward-only
  and input and output counts; synapse uniqueness, the weight bound and the
  exact count; feed-forward ordering; the input-fed first hidden neurons; the
  output-fed last hidden neurons; the outward-connection fix-up; seed
  determinism with no RNG state shared between calls; and a
  `Creature.fromJSON`/`exportJSON` round trip. Run on the final head:
  `deno test test/fixtures/LargeCreatureFixture.test.ts`, 6 passed, 0 failed.
  Run with the previous builder (9,630 hidden, fix-up after the fill): 4 passed,
  2 failed (the issue-shape totals test and the exact synapse-count test).
- `./quality.sh --skip-tests --skip-discovery`: passed on the previous head
  (format, lint, type check, WASM sync); on the final head only `deno fmt` and
  the test file above were run. The full test stage was not run: this host has
  no native `rust_scorer`. The diff adds one test file and changes no production
  code.
- Related existing tests were not edited.

## Mutation check

The earlier survivors in the fixture builder (previously in the bench) are now
covered by the test above; the builder lives at
`test/fixtures/LargeCreatureFixture.ts:42-113`. The bench is
`bench/TrainingFinalisationLargeCreature.ts` (94 lines), and its five
`Deno.bench` registrations are at lines 56-94.

- `bench/TrainingFinalisationLargeCreature.ts` bench registrations (`group`,
  `name` and the `fn` bodies of the five `Deno.bench` cases) exempt
  (untestable): a `Deno.bench` file is not imported by any test and timing is
  not allowed in `test/` (AGENTS.md); the cases only call library functions that
  have their own tests.

## Unmet criteria in this run

The `missing` criteria stay open. The next step needs a sloth@GRQ-3 sampler or
learn run on a release that carries #4149 and #4150, so the parent log shows
whether the held task was inside the native call or never reached `trainDir`.

Not done / not checked: the production corpus and the captured creatures; a 16
GB macOS host; branch 2 and branch 3; a trained-creature compaction pass in the
bench.
