## Summary

The native `trainDir` bridge now forwards the task's single effective deadline
to `libneat_ai_backpropagation` (FFI, `deadlineEpochMs`) and
`neat_ai_backpropagation` (CLI, `--deadline-epoch-ms`) once the backend has
advertised the `deadline` capability. A cooperative timeout comes back as a
normal result, and older engines keep running exactly as before with an explicit
"not enforced natively" warning. Version bump: no `VERSION` field is edited by
this change; the merged commit records the final version.

Part of #4119. Criteria still `partial` (see Acceptance Criteria): no required
CI job provisions the native engines (`./quality.sh --next` runs the real-engine
cases fail-closed, but it is a local/opt-in lane), and `./quality.sh` could not
run here. The unearned-score gap and the unbounded finalisation are closed in
the head commit.

```mermaid
flowchart TD
    S["prepareTraining: timeoutTS computed once"] --> P{"backend advertises<br/>deadline v1?"}
    P -- "yes" --> F["FFI deadlineEpochMs / CLI --deadline-epoch-ms"]
    P -- "no (older engine)" --> W["no field or flag, warn once:<br/>deadline NOT enforced natively"]
    F --> R["strict response: timedOut, timeout,<br/>completedEpochs, measures"]
    R --> M{"bestMeasure"}
    M -- "full" --> E1["error = bestMse"]
    M -- "partial / unmeasured" --> E2["error = pre-training error<br/>or NaN, never the partial mse"]
    E1 --> N["scheduleTraining scores and queues the weights"]
    E2 --> U["scheduleTraining queues the weights unscored:<br/>no calculateScore, no fine-tune, no tracker update"]
```

## Spec

### Intent and Rationale

- Field logs (issue comments, neat-ai 7.0.66 to 7.1.2) show native training
  tasks running past their deadline until the watchdog cancelled and quarantined
  the worker. The native engine now stops cooperatively, so the adapters must
  send it the deadline and accept its answer.
- Capability is probed before any new field or flag is sent, because old engines
  reject unknown request fields. This follows the Backprop #214 compatibility
  matrix ("New caller, old engine: the NEAT-AI adapter must probe and
  diagnose").
- The stale-branch `issue-4073-...` assumed "ABI 2". The final contract keeps
  ABI 1 and uses a capability probe, so only its ideas were reused (timing
  struct, NaN handling), not its ABI gating.

### Essential Design Decisions

- One deadline: `TrainingSetupState.timeoutTS` is computed once in
  `prepareTraining` (`min(now + trainingTimeOutMinutes, hardDeadlineTS)`), used
  by the TypeScript loop (`createEpochState`) and by both native adapters, so
  backend selection cannot restart the budget. The "hardDeadlineTS already
  expired" skip to the TypeScript loop is unchanged.
- A partial or unmeasured stop never supplies a score from the trainer.
  `TrainingResult.error` carries the creature's own pre-training error (the
  `error` tag, or the `untrained-error` tag that `WorkerHandler.trainTracked`
  sends instead), else `NaN`, which `isFailedTrainWorkerResponse` already treats
  as an unusable result. `scheduleTraining` does not turn that carried figure
  into a score: `isUnmeasuredTimeout` (timed out with a non-`full`
  `bestMeasure`) skips `calculateScore`, the regression check, the fine-tune
  variants and the regression-tracker update, closes the gain-log event as
  `trained` with no `scoreAfter`/`errorAfter`, and still queues the changed
  weights, which the next generation evaluates through the normal fitness path
  (the queued export carries no `score`). A `full` measure is scored as any
  other result.
- Finalisation is bounded: `packageTrainingResult` checks
  `isFinalisationWindowSpent(timeoutTS, now)` (now past deadline +
  `TRAINING_TASK_WATCHDOG_GRACE_MS`) before `finaliseTraining`. When spent, it
  logs a warning and returns the trained weights with no compacted copy
  (`finaliseTraining(..., { skipCompaction: true })`) rather than compacting
  past the watchdog window. The check is made once, before finalisation begins;
  a finalisation that starts inside the window and overruns it is still only
  reported after the fact.
- Capable backends are strict: a missing or inconsistent field is an error
  naming the field, and there is no TypeScript/WASM fallback.
- `timedOut` and `bestMeasure` are optional on `TrainingResult` and
  `ResponseData.train` and are copied across the worker boundary only when
  defined, so legacy and TypeScript responses keep their old shape.

### Undiscoverable Facts

- The Backprop engine used for verification was built from
  stSoftwareAU/NEAT-AI-Backpropagation `947cbb5` (v0.1.50, PR 216 / issue 214)
  and the legacy producer from `f444bc4` (v0.1.49); both are outside the
  repository, in `/tmp` of this run. Their provenance is in
  `test/fixtures/native-backprop/README.md`.
- `WorkerHandler.trainTracked` deletes the creature tags and sends the
  pre-training error only as `untrained-error`; the first worker run returned
  NaN until the bridge read that tag too.
- One full-file integration run under heavy host load (about 7.6) had the FFI
  productive case reach its 120 s hang guard; 15 standalone and 8 repeated
  full-file runs afterwards passed, and the cause is unidentified.

## Evidence

Real engines, final head,
`NEAT_AI_BACKPROP_DEADLINE_NEW=<new-engine-dir> NEAT_AI_BACKPROP_DEADLINE_LEGACY=<legacy-engine-dir>`:

| Scenario                               | adapter     | timedOut           | bestMeasure | weights changed / valid | settled after deadline        |
| -------------------------------------- | ----------- | ------------------ | ----------- | ----------------------- | ----------------------------- |
| productive, 1 s deadline               | FFI         | true               | partial     | true / true             | 30 to 42 ms                   |
| productive, 1 s deadline               | CLI         | true               | partial     | true / true             | 37 ms                         |
| already out of time                    | FFI and CLI | true               | unmeasured  | false / true            | 17 ms                         |
| through a real worker (`trainTracked`) | FFI         | true (on the wire) | partial     | true / true             | 53 ms, healthy, not cancelled |
| legacy engine, deadline set            | FFI and CLI | absent             | absent      | true / true             | warned, not stopped natively  |

Tool behaviour relied on (observed): the new engine's `capabilities` prints
`{"abiVersion":1,"capabilities":{"deadline":{"version":1,...}},"version":"0.1.50"}`;
the legacy CLI answers `error: unrecognized subcommand 'capabilities'` with exit
2; the legacy library lacks the `neat_backprop_capabilities` symbol (Deno 2.9
`dlopen` with `optional: true` returns `null`). Fixtures in
`test/fixtures/native-backprop/` come from those real binaries.

Issue numbers cited as provenance: #4118: Give the training worker and watchdog
one immutable task deadline; #4073: Rust trainDir (FFI/CLI) ignores the per-task
timeoutTS (closed; its branch was reviewed, not reopened);
NEAT-AI-Backpropagation#214: Expose cooperative deadlines through Backprop FFI
and CLI; #4126: Process never exits after evolveDir returns following a worker
quarantine (existing doc page linked, not changed in behaviour).

## Reproduction

- **symptom** — a native `trainDir` (FFI or CLI) was never given the task
  deadline: a long first epoch ran on until the stuck-task watchdog cancelled
  the task and quarantined its worker
  (`training task ... passed its per-task deadline without returning a result`).
- **status** — `partial` — reason: the regression was observed red by removing
  only the forwarding from the fixed bridge (the FFI spread and the CLI flag),
  which reproduces the base behaviour (the productive cases hit the 120 s guard,
  4 min 2 s and 2 min 4 s runs), rather than by checking out the base branch.
- **regression test** —
  `test/architecture/training/NativeDeadlineIntegration.ts::native deadline: FFI productive run stops at the deadline and keeps its learning`

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **partial** — Real `trainDir` calls forced independently through the actual
  FFI library and CLI return `timedOut: true` and changed, valid weights on a
  productive long-first-epoch fixture with a short deadline. — evidence:
  `test/architecture/training/NativeDeadlineIntegration.ts::native deadline: FFI productive run stops at the deadline and keeps its learning`
  and
  `::native deadline: CLI productive run stops at the deadline and keeps its learning`
  — reviewer: partial — reason: both passed against the real engines (earlier
  head; the engines were not rebuilt for the head commit), but they run only
  where an engine resolves. `./quality.sh --next` sets
  `NEAT_AI_BACKPROP_REQUIRE_FFI=1` and checks the library with
  `scripts/check_native_backprop_train.ts` first, so a missing engine fails
  there rather than being ignored; no required CI job runs that lane.
- **partial** — The scheduled-worker integration path settles by its original
  deadline plus 30 seconds, including adapter finalisation; returned weights
  reach existing result evaluation without timeout-driven
  cancellation/quarantine. — evidence:
  `test/architecture/training/NativeDeadlineIntegration.ts::native deadline: a productive run through a real worker settles at the deadline on a healthy worker`,
  `test/workers/TrainTimeoutFieldsCrossWorkerBoundary.ts` — reviewer: partial —
  reason: the real worker settles within the grace and the result passes
  `isFailedTrainWorkerResponse`; finalisation past the window now degrades
  explicitly (`isFinalisationWindowSpent`, `FinalisationWindow.ts`) and the
  scheduler's handling of the returned weights is tested at scheduler level
  (`test/NEAT/UnmeasuredTimeoutNotScored.ts`). Still outstanding: the scheduler
  is not driven through a real native engine, and finalisation that starts
  inside the window is not interrupted.
- **partial** — An already-expired/no-progress request and a timeout before any
  full epoch have explicit supported outcomes, without fabricated scores or
  unconditional parsing of an absent epoch journal. — evidence:
  `test/architecture/training/RustTrainDirDeadline.ts::Rust trainDir deadline: a partial measure never supplies the error`,
  `NativeDeadlineIntegration.ts::native deadline: FFI run already out of time stops unmeasured with the weights unchanged`
  — reviewer: partial — reason: no journal is read on the capable path, the
  outcomes are explicit, and the scheduler no longer scores partial/unmeasured
  weights from the carried error
  (`test/NEAT/UnmeasuredTimeoutNotScored.ts::deadline stop: a partial measure queues the weights without a score`);
  the real-engine confirmation is engine-gated as above.
- **partial** — Supported legacy FFI and CLI contracts receive no unsupported
  deadline fields/flags, retain prior execution behaviour and emit the required
  diagnostic. Fixtures are produced or verified by the actual legacy producer,
  not guessed. — evidence:
  `test/architecture/training/RustTrainDirDeadline.ts::Rust trainDir deadline: a legacy library never receives the deadline and is warned once`,
  `NativeDeadlineIntegration.ts::native deadline: a legacy CLI engine is warned and not stopped natively`,
  the CLI probe cases in `RustTrainDirDeadline.ts` — reviewer: partial — reason:
  the legacy CLI probe is covered by shell-script fakes copied byte for byte
  from the real legacy CLI, and the full legacy CLI run only by the engine-gated
  integration case; no legacy CLI train fixture was captured.
- **met** — A backend advertising deadline support must supply its required
  result metadata; malformed responses and genuine native errors fail
  explicitly. No silent TypeScript/WASM fallback is added. — evidence:
  `test/architecture/training/NativeBackpropCapabilities.ts`,
  `test/architecture/training/RustTrainDirDeadline.ts::Rust trainDir deadline: a capable library's legacy-shaped response is refused`
  — reviewer: met
- **partial** — Tests retain cancellation/quarantine for a genuinely wedged
  call, and native integration checks and the repository quality gate pass. —
  evidence: `test/NEAT/TrainingTaskDeadlineImmutable.ts`,
  `test/creature/ProcessExitsAfterWedgedWorker.ts` (unchanged and passing) —
  reviewer: partial — reason: `./quality.sh` could not run here (native
  `rust_scorer` is missing); the equivalent targeted checks passed instead (see
  Test Plan), and the native scripts that `quality.sh --next` runs now have
  hermetic tests (`test/scripts/NativeBackpropScripts.ts`).
- **unrequested** — a `worker-productive` scenario, `WorkerTrainResponse.ts` and
  an info log in `NeatScheduling.ts` — reviewer: unrequested — reason: needed so
  `timedOut`/`bestMeasure` survive the worker boundary the scheduler reads from;
  the log only reports, it adds no branch.
- **unrequested** — strict `deadlineEpochMs` validation in `nativeBackpropTrain`
  and the `__install...`/`__reset...ForTests` seams — reviewer: unrequested —
  reason: refuses an invalid deadline before a native call; the seams are how
  the doubles-based tests reach the real code.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

- **violation** — stale doc: `trainingTimeOutMinutes` listed as ignored by the
  Rust path — evidence: `src/config/TrainOptions.ts:43` — reason: fixed in this
  diff
- **violation** — docs said `hardDeadlineTS` is forwarded unchanged, but the
  effective `timeoutTS` is — evidence: `docs/TIMEOUTS.md:379`,
  `CHANGELOG.md:528` — reason: fixed in this diff
- **violation** — an elapsed-time threshold asserted in a test file — evidence:
  `test/architecture/training/NativeDeadlineIntegration.ts:289` — reason: fixed
  in this diff (the driver reports `settledWithinGrace` against
  `TRAINING_TASK_WATCHDOG_GRACE_MS`; the test asserts the boolean)
- **violation** — legacy CLI branch had no test in any gate — evidence:
  `src/architecture/training/RustTrainDirBridge.ts:755` — reason: fixed in this
  diff (four shell-fake probe tests in
  `test/architecture/training/RustTrainDirDeadline.ts`; the full legacy CLI run
  stays engine-gated)
- **clean** — Australian English; no `console.*` in `src/`; no `Deno.env.set` in
  tests; no source-text-grep tests; fail loud on malformed capability and
  response; no WASM fallback; named tests exist at the head. The reviewer's
  `optional` notes (unearned score; `cliDeadlineCapable` keyed to clap's message
  text) are recorded under Essential Design Decisions and Undiscoverable Facts.

## Test Plan

Review follow-up: the hermetic POSIX fake CLI now exercises `trainDir` with a
relative budget both with and without a hard deadline. It records the train
arguments and returns a captured capable-engine timeout response. Coverage:
`test/architecture/training/RustTrainDirDeadline.ts::Rust trainDir deadline: CLI forwards a relative budget with a hard deadline`
and
`::Rust trainDir deadline: CLI forwards a relative budget without a hard deadline`.
Both cases fail when the CLI forwards `hardDeadlineTS` instead of `timeoutTS`,
and when the deadline flag is removed; both mutations were restored.

Review follow-up: the previously uncovered relative-budget case is now checked
with and without a hard deadline by
`test/architecture/training/RustTrainDirDeadline.ts::Rust trainDir deadline: a relative budget is forwarded with a hard deadline`
and
`::Rust trainDir deadline: a relative budget is forwarded without a hard deadline`
and at setup by
`test/architecture/training/RustTrainDirDeadline.ts::prepareTraining: a relative budget earlier than the hard deadline sets timeoutTS`.
The obsolete documentation claimed partial stops were evaluated as normal; the
remaining behaviour queues usable results unscored, covered by
`test/NEAT/UnmeasuredTimeoutNotScored.ts::deadline stop: a partial measure queues the weights without a score`.
The timeout guide and changelog also describe the finalisation-window warning
and skipped compaction. Mutation checks: replacing FFI forwarding with
`hardDeadlineTS` failed both forwarding cases; replacing the setup calculation
with `hardDeadlineTS ?? 0` failed both forwarding cases and the setup case. Both
mutations were restored.

Final-head results (no `rust_scorer`, so `./quality.sh` itself did not run; it
stops at its rust_scorer check, exit before any step):

- `deno fmt --check` clean after formatting
  `test/fixtures/native-backprop/README.md`; `deno lint` clean (2320 files);
  `deno check` clean on `mod.ts`, `scripts/*.ts`,
  `test/architecture/training/*.ts`, `test/workers/*.ts`.
- `NEAT_AI_BACKPROP_ENABLED=0 deno test -A --preload test/_preload.ts --config ./deno.json --parallel`
  over `test/architecture/training`, `test/workers`, `test/config`,
  `test/scripts`, `test/docs`, `test/multithreading`, `test/NEAT`:
  `ok | 2756 passed | 0 failed | 8 ignored` (the ignored cases are the
  engine-gated native ones).
- With real engines (`NEAT_AI_BACKPROP_DEADLINE_NEW=<new-engine-dir>`,
  `..._LEGACY=<legacy-engine-dir>`,
  `NEAT_AI_BACKPROP_LIB_PATH=<new-engine-dir>`): `NativeDeadlineIntegration.ts`,
  `NativeBackpropCapabilities.ts`, `RustTrainDirDeadline.ts`:
  `ok | 42 passed | 0 failed`; `NativeDeadlineIntegration.ts` alone re-run after
  the last edit: `ok | 7 passed | 0 failed`. The 18 cases of
  `RustTrainDirDeadline.ts` re-ran green after the CLI-probe tests.

Added tests: `test/architecture/training/NativeBackpropCapabilities.ts` (parse,
refuse, doubles-based `nativeBackpropTrain`),
`test/architecture/training/RustTrainDirDeadline.ts` (forwarding, carry rules,
legacy warning once, `prepareTraining` `timeoutTS`, CLI probe fakes),
`test/architecture/training/NativeDeadlineIntegration.ts` (real FFI, CLI,
legacy, worker in child processes),
`test/workers/TrainTimeoutFieldsCrossWorkerBoundary.ts`. No assertion was
removed from an existing test;
`test/architecture/training/TrainingTaskWatchdog.ts` has a comment-only edit.

Red-checks (each restored and `cmp`-verified): forwarding spread removed (FFI
productive and worker cases hit the guard, expired case `timedOut` false); CLI
`--deadline-epoch-ms` removed (CLI productive hits the guard); `timedOut: false`
forced (4 integration cases red); `loadFrom(bestJson)` dropped (weights-changed
cases red); legacy guard changed to send the field
(`a legacy library never receives the deadline` red); partial mse used as the
error (`a partial measure never supplies the error` red); `untrained-error`
ignored (its carry case red); worker pass-through copy removed (2 of 3 cases
red); CLI probe `return false` and non-JSON-accepted breaks (cases 3 and 4 red).
The `error`-wins and `"undefined"` carry cases cannot catch the "ignore
`untrained-error`" mutation, which the dedicated case does.

Callers checked for `setup.timeoutTS`: `createEpochState` (TypeScript loop),
`tryFfiTrainDir`, `tryCliTrainDir`; every existing setup is built by
`prepareTraining`, so no existing test needed a change. Existing related-rule
check: `rustTrainDirSkipReason` (expired `hardDeadlineTS`) still precedes the
native call and keeps its test. Persisted data: none; the worker message only
gains optional keys. Docs sweep: `docs/TIMEOUTS.md` (new section and Training
bullet), `docs/config/TRAINING.md`,
`docs/troubleshooting/PROCESS_DOES_NOT_EXIT.md`, `src/config/TrainOptions.ts`,
`CHANGELOG.md`; siblings grepped: `trainingTimeOutMinutes`, `log`,
`targetError`. Stale-but-unchanged: `src/NEAT/Neat.ts:119` "Enforcement lands in
follow-up sub-issues" concerns the Neat-level field. No `deno.lock` change.

Head commit "Do not score deadline-stopped unmeasured weights...": `deno lint`
and `deno fmt --check` clean; `NEAT_AI_BACKPROP_ENABLED=0 deno test --parallel`
over `test/architecture/training`, `test/workers`, `test/scripts`, `test/NEAT`,
`test/multithreading`, `test/config`: `ok | 2521 passed | 0 failed | 8 ignored`.
New files: `test/NEAT/UnmeasuredTimeoutNotScored.ts`,
`test/architecture/training/FinalisationWindow.ts`,
`test/scripts/NativeBackpropScripts.ts`.

Mutation check: `scripts/native_deadline_probe.ts` and
`scripts/check_native_backprop_train.ts` were not importable, so no test could
reach them. Both now guard their entry point with `import.meta.main`;
`checkNativeBackprop(deps)` takes injected dependencies and
`checkAdapterPrecondition` takes the library path and an env reader. The helpers
(`SCENARIO_ADAPTER`, `fail`, `installRecorder`, `adapterFrom`,
`checkAdapterPrecondition`, `recordsFor`, `wideCreatureJSON`,
`chainCreatureJSON`) and every branch of the check are asserted in
`test/scripts/NativeBackpropScripts.ts`. Not re-run through the mutation tool.
`runTrainScenario`, `runWorkerScenario` and `main` need a real engine and stay
covered only by `NativeDeadlineIntegration.ts`.

Not done: no required CI job provisions the native engines (the real-engine
cases run under `./quality.sh --next`, with `NEAT_AI_BACKPROP_REQUIRE_FFI=1`);
the real engines were not re-run against the head commit; the scheduler is not
driven through a real native engine; finalisation that starts inside the window
is not interrupted; `./quality.sh` did not run here.

<!-- vibe-quality-gate-skipped reason="./quality.sh stops at its native rust_scorer prerequisite, which is not installed in this run; targeted fmt, lint, check and tests were run instead; CI runs the gate" -->
