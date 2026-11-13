## Summary

After a quarantine of native training, `evolveDir` now returns and its caller
exits on its own. Scheduled native training now awaits its FFI call or CLI
subprocess inside a real worker isolate, so `Worker.terminate()` can release the
worker. C-heap buffers and an OS loader reference keep a late native return
safe. Native-enabled runs keep that work out of the main isolate, including with
`threads: 1`. The fleet-log closing evidence cannot exist until this ships. Part
of #4126.

## Spec

### Intent and Rationale

- A worker blocked inside a synchronous FFI call ignores `terminate()`, and Deno
  keeps the process alive for that thread. A `nonblocking: true` alias of
  `neat_backprop_train` (or an awaited `Deno.Command` for the CLI) leaves the
  worker's JavaScript thread free, so terminating it works.
- Awaiting alone is unsafe: Deno can unload the worker's library and free its
  buffers before the native call returns. Request and output buffers live on the
  C heap, and a separate `dlopen` reference keeps the code mapped.

### Essential Design Decisions

- Synchronous `trainDir` stays, sharing validation, deadline, error and result
  packaging with the new async path (`prepareBinaryRun`, `resolveRustOutcome`).
- When native training is enabled (`isRustTrainDirEnabled()`), `evolveDir` uses
  real workers even at `threads: 1`. A worker-init failure then throws rather
  than falling back to in-process execution, because a mock worker cannot drop a
  pending FFI call held by the main isolate. WASM-only runs keep the direct path
  and its fallback.
- Training stays one-at-a-time per worker isolate. Awaiting the native call
  frees the worker's event loop, and the entry point does not serialise
  messages, so `WorkerProcessor` chains each `train` request behind the previous
  one's settled promise. A heavy worker therefore never runs two native trainers
  at once, as when the call was synchronous, and `terminate()` still works
  because the chain is awaited.
- A terminated call abandons its C allocations, loader reference and temporary
  directory until process exit. It does not cancel the native computation; #4146
  tracks the native deadline overruns.
- The teardown count stays conservative. An unanswered task is counted even when
  its worker was awaiting native work and could terminate, because JavaScript
  cannot observe whether a terminated thread has ended. The warning now says
  native work "may still be running", and the opt-in
  `exitOnUnreclaimableWorkers` guard is unchanged.

### Undiscoverable Facts

- Re-measured on 2026-11-13 (Deno 2.9.8, Linux): a worker running
  `while (true) {}` still pins the process after `terminate()` (killed at a 20 s
  timeout). Pure JS/WASM busy loops therefore stay unreclaimable, and
  `docs/TIMEOUTS.md` keeps that guidance.
- A C probe without the retained loader reference unloaded its pending library
  and died with SIGSEGV on a late return. The retained-reference regression test
  exits 0.
- The downstream production repo's mitigation (its tracking issue opting callers
  into `exitOnUnreclaimableWorkers`) is closed. This PR changes no code in that
  repo.

## Evidence

Backend/CLI change only; no visual surface changed.

- `test/creature/EvolveDirNativeProcessExit.ts` runs the real `evolveDir` in a
  child process with the exit guard off. A scheduled training task enters a C
  stand-in trainer (FFI or CLI) that blocks on a FIFO. The task watchdog
  abandons it past its deadline and the worker is quarantined. The child prints
  `EVOLVE_RETURNED` and `CALLER_LAST_STATEMENT`, and the test asserts it then
  exits with code 0 inside a 30 s watchdog.
- Ownership checked against Deno's
  [nonblocking FFI call](https://github.com/denoland/deno/blob/v2.7.0/ext/ffi/call.rs)
  and
  [library resource lifetime](https://github.com/denoland/deno/blob/v2.9.8/ext/ffi/dlfcn.rs).
- The legacy engine stand-in (`-DTRAINER_LEGACY`) mirrors
  `test/fixtures/native-backprop/README.md`: version `0.1.49`, no
  `neat_backprop_capabilities` symbol, no `capabilities` subcommand, and a
  request carrying `deadlineEpochMs` is refused. The NEW-engine responses replay
  the committed captures from NEAT-AI-Backpropagation `947cbb5`.
- Issues cited: #4126 (Process never exits after evolveDir returns following a
  worker quarantine); #4146 (Recurrence of #4119 on 7.1.12 + engine 0.1.50:
  training tasks still overrun the per-task deadline), open. The downstream
  production repo's issue about ignoring NEAT-AI's 'call Deno.exit()' teardown
  warning is closed.

```mermaid
sequenceDiagram
    participant App as Caller script
    participant Evolve as evolveDir
    participant W as Training worker
    participant Native as Native thread
    W->>Native: nonblocking train (C-heap buffers, retained library)
    Evolve->>W: deadline missed → quarantine → terminate()
    Note over W: isolate released, JS thread was not blocked
    Note over Native: may continue — code and buffers stay valid
    Evolve-->>App: result + conservative teardown warning
    App->>App: save, last statement
    Note over App: process exits without waiting for native work
```

## Reproduction

- **symptom** — the caller runs its final statement after a training-task
  quarantine, but the Deno process never exits.
- **status** — `verified` — the regression test was observed failing against the
  unfixed `origin/Develop` (`e275a827`) production code in this run:
  `EVOLVE_RETURNED` and `CALLER_LAST_STATEMENT` printed, then the child was
  killed by the 30 s watchdog. It passes at the head. The blocking trainer is a
  C ABI stand-in. The fleet's native-engine overrun itself (#4146) is not
  reproduced.
- **regression test** —
  `test/creature/EvolveDirNativeProcessExit.ts::evolveDir exits after scheduled native training is quarantined without the exit guard`

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **met** — Reproduce: a test where one scheduled training task blocks
  synchronously, past its deadline (e.g. a stub FFI/CLI trainer or a worker
  busy-loop), gets quarantined, and `evolveDir` then returns. Assert that the
  hosting deno process **exits within a bounded time** (e.g. 30 s) after the
  caller's last statement. This is the regression test that would have caught
  it. — evidence:
  `test/creature/EvolveDirNativeProcessExit.ts::evolveDir exits after scheduled native training is quarantined without the exit guard`,
  plus the CLI, `threads: 1` and late-native-return cases in the same file —
  reviewer: met
- **met** — Fix in neat-ai so a quarantined/terminated worker or watchdog can't
  pin the process. If a thread genuinely can't be reclaimed, `evolveDir` should
  report it (e.g. `[evolveDir] teardown: N worker(s) could not be stopped`) so
  callers can exit explicitly. — evidence:
  `src/multithreading/workers/WorkerProcessor.ts`,
  `src/architecture/Training.ts` (`trainDirAsync`),
  `src/architecture/training/NativeBackpropLibrary.ts`,
  `src/architecture/training/NativeHeap.ts`,
  `src/architecture/training/NativeLibraryLease.ts`,
  `src/architecture/training/RustTrainDirBridge.ts`,
  `src/creature/CreatureTraining.ts`, `src/creature/BoundedEvolveTeardown.ts` —
  reviewer: met — the report already existed on Develop
  (`handleUnreclaimableWorkers`); native computation is detached, not cancelled,
  as the CHANGELOG states.
- **missing** — In GRQ, separately: the `EvolveApp`s can end with an explicit
  `Deno.exit(0)` after cleanup as a belt-and-braces guard. That is a mitigation,
  not this fix. — reviewer: missing — reason: nothing in this diff touches GRQ,
  and no `EvolveApp` gains a `Deno.exit(0)`. The issue scopes this as separate
  work in another repository, which cannot be changed from this one.
- **missing** — Closing evidence: a quoted fleet log showing a quarantine
  (`[worker-N] quarantined`) followed by the unit's
  `[phase] ✔ END industry-evolve` (or equivalent) within a minute of
  `Cleaned up .tmp/train`. — reviewer: missing — reason: such a log can only
  exist after a release carrying this change runs on the fleet.
- **unrequested** — the per-worker training queue (`trainingTail` in
  `src/multithreading/workers/WorkerProcessor.ts`) and its test
  `test/architecture/training/NativeTrainingWorkerResults.ts::native worker runs two training tasks sent to it one after the other (Issue #4126)`
  with `fixtures/WorkerNativeTrainSerial.ts` — reviewer: unrequested — reason:
  fixes a regression the async change introduced (several native trainings at
  once on one worker).
- **unrequested** — `docs/archive/handover/issue-4126.md` — reviewer:
  unrequested — reason: a progress note the automation wrote when an earlier run
  was interrupted, not an issue deliverable.
- **unrequested** — `src/multithreading/workers/MockWorker.ts` comment and
  `docs/cspell.json` word additions — reviewer: unrequested — reason: comment
  and spelling-list updates that follow from the fix.
- **unrequested** — `removeWorkDir` in
  `src/architecture/training/RustTrainDirBridge.ts` now logs a warning when
  temp-dir cleanup fails — reviewer: unrequested — reason: the shared cleanup
  previously swallowed the error silently (fail-loud standard), and the async
  path relies on it.
- **unrequested** — `freeOwnedBuffer` in
  `src/architecture/training/NativeBackpropLibrary.ts` logs an error when the
  native free fails — reviewer: unrequested — reason: the helper is shared with
  the new async path and previously swallowed the error.
- **unrequested** — `CHANGELOG.md` rewords the #4146 entry ("before its blocking
  native call" → "before invoking native training") — reviewer: unrequested —
  reason: keeps that entry true now that the worker path awaits the call.
- **unrequested** — `docs/troubleshooting/MEMORY.md` puts a historical
  `threads: 1` measurement in the past tense — reviewer: unrequested — reason:
  native-enabled `threads: 1` no longer runs in-process, so the old present
  tense became false.
- **unrequested** — `docs/archive/pr-summaries/pr-summary-4126.md` replaces the
  earlier summary for this issue — reviewer: unrequested — reason: required
  deliverable; the earlier PR's record stays in git history and its PR
  description.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

This repository has no `CODING-STANDARDS.md`. The reviewer was given
`AGENTS.md`, `docs/ENGINEERING_PRINCIPLES.md` and `docs/DOC_STYLE.md`.

- **violation** — stub more permissive than the real callee: the legacy worker
  case served a hand-written capabilities JSON through a symbol the real 0.1.49
  engine does not export, and accepted any request — evidence:
  `test/architecture/training/NativeTrainingWorkerResults.ts:65` — reason: fixed
  in this diff. The stand-in is now built with `-DTRAINER_LEGACY`: version
  `0.1.49`, no capabilities symbol or subcommand, and `deadlineEpochMs` refused.
- **clean** — Logging only via `getLogger()` in `src/`; no `@std/log`,
  `@std/datetime` or polyfill; no `Deno.env.set`/`delete` in tests; timers only
  bound hangs, never asserted; no source-text greps; native failures throw (no
  fallback, principle 7); neuron UUID, creature UUID, semantic version and wire
  formats untouched; every named test exists; no workflow change; Australian
  English. No existing test assertion was edited. The documents mark no rule as
  enforced by review only. Optional notes acted on: the orphaned discovery
  bullet in `docs/troubleshooting/PROCESS_DOES_NOT_EXIT.md` and the "blocking
  native call" wording in `docs/TIMEOUTS.md`.

## Test Plan

- [x] `test/creature/EvolveDirNativeProcessExit.ts`: five child-process cases
      (FFI, late FFI return after termination, CLI, `threads: 1` FFI,
      `threads: 1` CLI). Each asserts native entry, quarantine,
      `EVOLVE_RETURNED`, `CALLER_LAST_STATEMENT` and exit code 0. The first case
      failed on base (killed at 30 s) and passes at the head.
- [x] `test/architecture/training/NativeTrainingWorkerResults.ts::native worker runs two training tasks sent to it one after the other (Issue #4126)`:
      two `worker.train()` calls on one real `WorkerHandler` must give native
      `entered, finished, entered, finished`. With the queue removed it failed
      with `entered, entered`; with the queue it passes.
- [x] `test/creature/EvolveDirNativeWorkerInit.ts`: a native-enabled init
      failure refuses the in-process fallback; the WASM direct and fallback
      controls complete.
- [x] `test/architecture/training/NativeTrainingWorkerResults.ts`: FFI/CLI
      completion and errors, trained genome and metrics, and deadline
      forwarding. The legacy case now runs against the faithful 0.1.49 stand-in,
      so it fails if a deadline is ever sent to a legacy engine.
- [x] `test/architecture/training/NativeBackpropTrainNonBlocking.ts`,
      `test/architecture/training/NativeHeap.ts`,
      `test/architecture/training/TrainDirAsync.ts`: deadline refusals, native
      errors, a library close deferred during a pending call, independent C
      memory, and parity with synchronous results.
- [x] Targeted run at the head: `NativeTrainingWorkerResults.ts`,
      `EvolveDirNativeProcessExit.ts`, `NativeBackpropTrainNonBlocking.ts`,
      `TrainDirAsync.ts`: 16 passed, 0 failed. An earlier run of the seven issue
      files with `test/multithreading/WorkerHandler.ts`: 28 passed, 0 failed.
- [x] Full `./quality.sh` with `--rust-scorer-bin` pointing at a scorer built
      from NEAT-AI-scorer `742c5df`, run at `e88431db`: **10347 passed (5
      steps), 0 failed, 50 ignored**. Afterwards the working tree was clean.
- [x] Base check repeated at the head of this run: with the new test files
      copied onto a detached `origin/Develop` (`e275a827`) worktree, the first
      `EvolveDirNativeProcessExit.ts` case failed (`killed` was `true` after the
      30 s watchdog); at the head all five cases pass.
- [x] Targeted run after the verifier fixes: 64 files (`test/multithreading/`,
      `test/architecture/training/`, `test/workers/`, the `EvolveDir*` and
      `ProcessExitsAfterWedgedWorker` files, `EvolveCleanupOnThrow_test.ts`).
      With `NEAT_AI_BACKPROP_ENABLED=0`: 430 passed, 0 failed, 9 ignored. With
      `=1`: 429 passed, 1 failed. The failure is `TrainingLoop.ts` ("trainDir
      returns a well-formed result for a tiny dataset"): the native library is
      not installed on this host. It fails the same way on `origin/Develop`.
- Existing tests edited: one. `test/creature/EvolveCleanupOnThrow_test.ts` ("a
  worker init failure terminates the failed worker and falls back to a direct
  worker (Issue #4072)") now pins the WASM lane it describes with the
  isolate-local `__setRustTrainDirEnabledForTests(false)`, restored in
  `finally`. Before this, the test failed whenever native training was enabled
  (the default, and `./quality.sh --next`). No assertion was changed or removed.
  It passes with `NEAT_AI_BACKPROP_ENABLED=1`.
- Documentation updated: `docs/api/COMPUTE.md` (the worker-init fallback applies
  only when native training is disabled), `docs/config/WORKERS.md` (including
  one native training task at a time per worker),
  `docs/troubleshooting/PROCESS_DOES_NOT_EXIT.md` (Cause and Diagnose),
  `docs/TIMEOUTS.md` (teardown warning, backend and phase lines),
  `docs/api/TRAINING.md`, `docs/troubleshooting/MEMORY.md`,
  `test/fixtures/native-backprop/README.md`, `CHANGELOG.md`, and
  `docs/cspell.json` (library and compiler terms).

## Deno regression avoided

- Used Deno workers, `Deno.dlopen` nonblocking FFI and `Deno.Command`. No Node
  tooling was added.

## Merge verification

CI and code review are pending.

Not checked: macOS and Windows execution (all process tests are ignored on
Windows, and the macOS `libSystem.B.dylib` loader path is untested here); a
non-glibc Linux, where `libc.so.6`/`libdl.so.2` may not resolve; and fleet logs.
Native computation can continue after a quarantine, holding memory until process
exit and leaving its temporary directory on disk.
