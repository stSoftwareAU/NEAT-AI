## Summary

The #4053 first-generation bound is enforced by `awaitWithinHardDeadline`, a
`setInterval` poll on the **same event loop** as the work it bounds, so a main
thread that stops yielding starves it. Generation 1 is now also bounded
off-thread. `evolveDir`, `evolveEnv` and `evolveRL` arm a watchdog worker
(`src/NEAT/FirstGenerationWatchdog.ts` and
`src/NEAT/FirstGenerationWatchdogWorker.ts`) just before generation 1's
`neat.evolve()` is called. They disarm it (terminate the worker) when that await
settles. If the watchdog is still armed 60 s after the bound, it logs
`[Neat] First generation wedged after Ns (first-generation bound passed while
the main thread was not yielding …)`
from the worker thread and ends the process with `SIGKILL`. A watchdog worker
that cannot start (for example, no read access to its module) is logged at warn
level and skipped. The run it guards carries on. Closes #4060. Two criteria
remain `missing` (see Acceptance Criteria): the issue's root-cause capture and
its closing field evidence can only come from a GRQ host.

## Spec

### Intent and Rationale

- Nothing on a blocked JS event loop can bound that loop, so the bound has to
  live on another thread. A Deno Worker has its own event loop and heap, so it
  keeps running while the main isolate busy-loops or thrashes in GC.
- This repo can deliver an in-process backstop. The issue offered caller-side
  guidance as an alternative, and `docs/TIMEOUTS.md` now also documents it as
  defence in depth.

### Essential Design Decisions

- The watchdog kills with `SIGKILL`. `evolveDir` registers a `SIGTERM` listener,
  which needs the blocked loop to run, so `SIGTERM` is swallowed. A worker's
  `Deno.exit()` only closes the worker, which I observed on this host.
- `withFirstGenerationWatchdog` arms **before** `run()` calls `neat.evolve()`,
  so it also covers a block in `evolve()`'s synchronous prefix. The child test
  depends on this ordering.
- The watchdog fires 60 s after the bound
  (`FIRST_GENERATION_WATCHDOG_SLACK_MS`), so a responsive loop's in-process path
  (1 s poll) wins first. That path disarms the watchdog and still returns
  `first-generation-wedged` with teardown. The kill path writes no new
  checkpoint, which the docs and CHANGELOG say.
- The watchdog must never be what ends a healthy run. Deno re-throws an error
  that a child worker leaves unhandled in the parent, so
  `armFirstGenerationWatchdog` sets `worker.onerror`. That handler calls
  `preventDefault()` and logs
  `[Neat] First-generation watchdog unavailable: <cause> — generation 1 is
  bounded only in-process`
  at warn level. There is no `messageerror` handler: the worker never posts a
  message to the parent, so that event cannot fire.
- Only generation 1 is armed, once per run. Nothing is spawned when
  `timeoutMinutes` is 0.

### Undiscoverable Facts

- With `threads: 1` (all three failing GRQ runs: `heavyWorkers 1, threads 1`),
  `evolveDir` sets `preferDirect` and the only `WorkerHandler` is a
  `MockWorker`. Fitness and the scheduled training then run in-process on the
  main thread (`src/creature/CreatureTraining.ts`
  `preferDirect = threads === 1`; `src/multithreading/workers/MockWorker.ts`
  `this.processor.process(data)`). So the issue's "the training task runs on a
  worker" does not hold for these runs. This is consistent with the comment that
  the bound fired on the 12-worker GRQ-3 run and failed on every 1-worker run.
- On Deno 2.9.6 here, `Deno.kill(Deno.pid, "SIGKILL")` from a worker killed a
  busy-looping process even when it ran with only `--allow-read`. The
  kill-refused branch exists for hosts that refuse it, and it logs the cause.

## Evidence

Backend-only change; no UI files.

```mermaid
sequenceDiagram
    participant Main as Main thread
    participant WD as Watchdog worker
    Main->>WD: arm (before generation 1 evolve)
    alt generation 1 settles, or the in-process bound fires
        Main->>WD: disarm (terminate)
    else main thread never yields
        Note over WD: bound + 60 s passes
        WD->>WD: log "[Neat] First generation wedged after Ns …"
        WD->>Main: Deno.kill(Deno.pid, "SIGKILL")
    end
```

- **Tool behaviour observed (scratch script, deleted):**
  - In a worker, `Deno.exit(124)` left the busy main thread running and the
    process exited 0.
  - `Deno.kill(Deno.pid, "SIGKILL")` from a worker, with a `SIGTERM` listener
    registered and the main thread in `for (;;) {}`, ended the process with
    status 137 (`Killed`). It did the same under `--allow-read` only.
- **Issue numbers cited:**
  - #4060: evolveDir first-generation bound (#4054) did not fire on 7.0.55 …
  - #4053: the first-generation bound this backs up, cited in existing code
  - #4063: Flaky test: MakeUuidDirectConstruction …, filed this run

**Docs sweep** — grep: `awaitWithinHardDeadline`, `first-generation-wedged`,
"First generation wedged", "first-generation bound", "in-process"; section:
`docs/TIMEOUTS.md#-the-off-thread-first-generation-watchdog-issue-4060` (new)
and `docs/TIMEOUTS.md#️-the-external-watchdog-is-unchanged`; siblings:
`teardownBudgetMS`, `startTimeMS` (the existing `EvolveDirDeps` members; no doc
lists the deps set); updated: `docs/TIMEOUTS.md`, `CHANGELOG.md`,
`src/NEAT/HardDeadlineRace.ts` (module doc). The test links in
`docs/TIMEOUTS.md` follow the two test files' renames to `_test.ts`.

Hits left in place:

- `docs/TIMEOUTS.md` propagation `sequenceDiagram` ("abandon it … return
  terminationReason first-generation-wedged") — still true because it shows the
  responsive-loop path, which is unchanged.
- `src/creature/CreatureTraining.ts:672` ("breaching it ends the run with
  terminationReason first-generation-wedged") — still true for the in-process
  path, and the comment added directly below it names the off-thread backstop.

## Reproduction

- **symptom** — loop-2 generation 1 sat silent for ~2 h with no
  `First generation wedged` line, and was killed only by GRQ's stale window.
  Example:
  `20261013-132901 run_core: node log silent: no output for 7208s
  (stale window 7200s)`.
- **status** — `partial` — reason: the regression test reproduces a blocked main
  thread defeating the bound. Against base production code
  (`git show f089c75f:src/creature/CreatureTraining.ts`) all three child runs
  hung until the 60 s guard:
  `AssertionError: child never terminated — the
  first-generation bound did not fire on a blocked event loop`,
  0 passed / 3 failed. With the fix they pass. What blocked the field runs (GC
  thrash vs a long synchronous in-process training step) was not reproduced; the
  host captures are on GRQ machines this run cannot reach.
- **regression test** —
  `test/creature/FirstGenerationBlockedEventLoop_test.ts::evolveDir: a blocked main thread still ends at the first-generation bound`
  (plus the `evolveEnv` and `evolveRL` cases)

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **missing** — Root cause quoted from a reproduction, or from a host-side
  capture (`~/logs/training-hangs/in-flight/training-task-b08ca7f0.json` on
  rocket@GRQ-19), confirming or excluding the GC-thrash theory. — reviewer:
  missing — reason: the capture lives on GRQ-19, which this run cannot reach.
  The diff confirms the mechanism (a blocked loop starves the bound, and
  `threads: 1` runs training on the main thread) but not what blocked it.
- **met** — A bound that does not depend on the bounded event loop yielding. For
  example, a worker-thread or out-of-process watchdog that terminates the
  isolate, or documented guidance that the caller (GRQ `sampler.sh`) must
  enforce `timeout + first-generation bound` as a hard per-loop kill. —
  evidence: `src/NEAT/FirstGenerationWatchdog.ts`,
  `src/NEAT/FirstGenerationWatchdogWorker.ts`, caller guidance in
  `docs/TIMEOUTS.md` — reviewer: met
- **partial** — Regression test: a generation-1 `evolve()` that blocks the main
  thread synchronously (a busy loop past the bound) must still end at the
  first-generation bound with `first-generation-wedged`. — evidence:
  `test/creature/FirstGenerationBlockedEventLoop_test.ts` — reviewer: partial —
  reason: the run ends via SIGKILL plus a log line carrying
  `first-generation-wedged`, not a returned `terminationReason`, because nothing
  in-process can return from a loop that never yields. The test uses slack 0,
  not the production 60 s.
- **missing** — Closing evidence: a quoted
  `[Neat] First generation wedged after
  …` line, or a loop-≥2
  `Generation 1 … time …` line after an OOM-retry relaunch, from a GRQ host on
  the fixed release. — reviewer: missing — reason: this needs this PR released
  and run on a GRQ host.
- **unrequested** — `firstGenerationWatchdogSlackMS` on `EvolveDirDeps` —
  reviewer: unrequested — reason: a test seam like `teardownBudgetMS`. Without
  it the end-to-end test would wait the real 60 s slack.
- **unrequested** — the watchdog also wraps `evolveEnv` and `evolveRL` —
  reviewer: unrequested — reason: they share the same `setInterval`
  first-generation bound (#4056), so the same blocked-loop defect applied to
  them.
- **unrequested** — the `docs/TIMEOUTS.md` deadlines table is re-flowed —
  reviewer: unrequested — reason: `deno fmt` column widths after one appended
  sentence in a row.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

The repo has no `CODING-STANDARDS.md`. The reviewer was given `AGENTS.md` and
`docs/ENGINEERING_PRINCIPLES.md`.

- **clean** — no violations. The diff removes no test assertions and changes no
  existing expected value. Every named test exists. Review-enforced rules
  checked:
  - logging through `getLogger()` (no `console.*` in `src/`)
  - Temporal vs `Date.now()` (elapsed and deadline use only)
  - no fallback / dual path (principle 7)
  - no `Deno.env.set` in tests (the risky case runs in a child process)
  - Australian English
  - behaviour-not-implementation tests
  - an application-agnostic library
  - Optional notes, not chased: the child code string uses `Date.now()` to
    anchor a past start, as `EvolveDirHardDeadline.ts` does. The real-worker
    unit cases turn off sanitizers. The wrapper repeats at three call sites, one
    per entry point.

## Test Plan

- Added `test/NEAT/FirstGenerationWatchdog_test.ts` (14 tests):
  - the due predicate at the boundary
  - the request posted to the worker (every field, including the poll interval)
  - the fire path: log plus one kill; a refused kill (an `Error` and a
    non-Error) is reported with its exact cause, not thrown; a failing log still
    kills
  - the poll: never fires before it is due; fires once when due, even when the
    kill fails (injected clock, 1 ms interval)
  - arming: no spawn when the deadline is 0; a handle when a bound is set
  - the real-worker wrapper returning a value and propagating a rejection
  - child process, real worker: armed past its bound with the main thread in
    `for (;;) {}`, the child is SIGKILLed and logs
    `[Neat] First generation wedged after 10Ns`
  - child process, no permissions: the worker cannot read its module, the
    `unavailable` warning is logged, and the wrapped run still resolves
    (`RESULT=42`, clean exit)
- Added `test/creature/FirstGenerationBlockedEventLoop_test.ts` (3 tests): one
  child process per entry point. `evolve()` is stubbed to `for (;;) {}`, so the
  in-process poll can never run. Each test asserts:
  - SIGKILL, not a clean exit
  - the `[Neat] First generation wedged after` line, plus
    `main thread was not yielding` and `first-generation-wedged`
  - `EVOLVE_RETURNED` never printed
  - no 60 s guard kill
- **Pre-PR verifier finding (`FirstGenerationWatchdog.ts`, no worker error
  handler) — reproduced and fixed.** At the previous head, a script that only
  wrapped a 2 s healthy `run()` in `withFirstGenerationWatchdog` crashed when
  run with `--allow-read=/tmp`, with no permission flags, or with `--deny-read`.
  The output was
  `error: Uncaught (in promise) Error: Unhandled
  error in child worker.` and
  `RESULT` was never printed. With the `onerror` handler, all of these runs log
  the `unavailable` warning, print `RESULT 7` and exit 0. The no-permissions
  child test pins it. Removing `e.preventDefault()`, or the whole handler, turns
  that test red.
- **Mutation check.** The gate reported "no test imports this module" for every
  watchdog line. Those tests imported through the `@neat/` alias, and the test
  files were not named as tests (the #4056 precedent). Changes:
  - Both test files now import by relative path and are named `_test.ts`.
  - `FirstGenerationBlockedEventLoop_test.ts` imports `evolveDir`, `evolveEnv`
    and `evolveRL` from `../../src/creature/CreatureTraining.ts`. Test names
    come from those functions.
  - Two pieces moved out of the worker entry into `FirstGenerationWatchdog.ts`
    so unit tests reach them: the request literal became
    `firstGenerationWatchdogRequest()`, and the poll loop became
    `pollFirstGenerationWatchdog()`. The worker entry now only wires the real
    log and kill into the poll.
  - Each listed mutant was re-run by hand on its current line, one at a time
    (`deno test -A --no-check`, the relevant test file). Every one went red:

| Listed line (old)                  | Mutant                                | Now in                           | Result                     |
| ---------------------------------- | ------------------------------------- | -------------------------------- | -------------------------- |
| `FirstGenerationWatchdog:57`       | due predicate returns undefined       | same                             | 3 failed                   |
| `FirstGenerationWatchdog:75`       | delete `actions.kill()`               | same                             | 6 failed                   |
| `FirstGenerationWatchdog:77`       | negate `err instanceof Error`         | same                             | 2 failed                   |
| `FirstGenerationWatchdog:102`      | negate `if (!deadlineMS)`             | same                             | 2 failed, then test killed |
| `FirstGenerationWatchdog:108`      | delete `startMS`                      | `firstGenerationWatchdogRequest` | 2 failed                   |
| `FirstGenerationWatchdog:109`      | delete `deadlineMS`                   | `firstGenerationWatchdogRequest` | 2 failed                   |
| `FirstGenerationWatchdog:110`      | delete `slackMS`                      | `firstGenerationWatchdogRequest` | 2 failed                   |
| `FirstGenerationWatchdog:111`      | delete `pollIntervalMS`               | `firstGenerationWatchdogRequest` | 1 failed                   |
| `FirstGenerationWatchdog:113`      | delete `worker.postMessage(…)`        | same                             | 1 failed (guard)           |
| `FirstGenerationWatchdog:114`      | arm returns undefined                 | same                             | 1 failed                   |
| `FirstGenerationWatchdog:133`      | wrapper returns undefined             | same                             | 2 failed                   |
| `FirstGenerationWatchdogWorker:22` | negate the due check                  | `pollFirstGenerationWatchdog`    | 3 failed                   |
| `FirstGenerationWatchdogWorker:23` | delete `clearInterval(pollId)`        | `pollFirstGenerationWatchdog`    | 1 failed                   |
| `FirstGenerationWatchdogWorker`    | delete the poll call                  | worker entry                     | 1 failed (guard)           |
| `FirstGenerationWatchdogWorker:25` | delete `log`                          | worker entry                     | 1 failed                   |
| `FirstGenerationWatchdogWorker:26` | delete `kill`                         | worker entry                     | 1 failed (guard)           |
| new                                | delete `e.preventDefault()`           | `armFirstGenerationWatchdog`     | 1 failed                   |
| new                                | drop the `onerror` handler            | `armFirstGenerationWatchdog`     | 1 failed                   |
| `CreatureTraining:686`             | negate `generation === 0` (evolveDir) | same                             | 1 failed (guard)           |
| `CreatureTraining:1077`            | negate `generation === 1` (evolveEnv) | same                             | 1 failed (guard)           |
| `CreatureTraining:1653`            | negate `generation === 1` (evolveRL)  | same                             | 1 failed (guard)           |

- The listed `test/NEAT/FirstGenerationWatchdog.ts` mutants changed the test
  file itself. The gate ran no test against them ("no test imports this
  module"). That file is now `FirstGenerationWatchdog_test.ts`, named as a test.
- No line is recorded as exempt.
- Red runs from the original change:
  - With base `CreatureTraining.ts`, all 3 child tests failed with
    `child never terminated …` (run by me).
  - Disabling one call site at a time (deadline argument `0`) turned only that
    entry point's test red, for each of `evolveDir`, `evolveEnv` and `evolveRL`.
- Targeted run on the final head:
  `deno test -A test/NEAT/FirstGenerationWatchdog_test.ts test/creature/FirstGenerationBlockedEventLoop_test.ts test/creature/EvolveDirFirstGenerationWedged.ts test/creature/EvolveDirFirstGenerationHardDeadline.ts test/creature/EvolveDirHardDeadline.ts test/creature/EvolveEnvHardDeadline_test.ts test/creature/EvolveRLHardDeadline_test.ts test/NEAT/HardDeadlineRace.ts`
  — 39 passed, 0 failed. `deno fmt --check`, `deno lint` and `deno check` were
  clean on the changed files.
- `./quality.sh --rust-scorer-bin=<built NEAT-AI-scorer rust_scorer>` ran on the
  previous head, before the fixes above. fmt, lint and check were clean. Tests:
  9888 passed, 1 failed. The failure was
  `test/architecture/MakeUuidDirectConstruction.ts` "different squash produces
  different UUIDs", which this diff does not touch. It passed 6/6 when run
  alone: two random creatures can differ in synapse count. Filed as #4063. The
  worker re-runs the full gate on this head.
- No pre-existing test was edited. No existing test needed fixture changes: the
  full gate ran every `startTimeMS` test with the watchdog live, and none was
  killed.
- Callers and siblings checked: every `awaitWithinHardDeadline(neat.evolve(…))`
  site in `src/creature/CreatureTraining.ts` (`evolveDir`, `evolveEnv`,
  `evolveRL`) is wrapped. `evolveDataSet` delegates to `evolveDir`.

**Branch outcomes:**

- `armFirstGenerationWatchdog` `if (!deadlineMS) return undefined`:
  - no bound, nothing spawned: "no bound means nothing is spawned"
  - bound set, worker armed: "a bound arms a watchdog that can be disarmed",
    plus the child tests
- `armFirstGenerationWatchdog` `worker.onerror`:
  - worker loads: every real-worker case
  - worker cannot load: "a watchdog that cannot load is logged and the run still
    resolves"
- `isFirstGenerationWatchdogDue` (strictly past deadline + slack) — "only
  strictly past deadline + slack" covers both outcomes at the boundary.
- `pollFirstGenerationWatchdog`:
  - not due: "never fires before it is due"
  - due: "fires once when due, even if the kill fails"
- `fireFirstGenerationWatchdog`:
  - kill succeeds: "logs the wedge and kills once"
  - kill throws an `Error`: "a failing kill is reported, not thrown"
  - kill throws a non-Error: "a non-Error kill failure is reported as text"
  - log throws: "a failing log still kills"
- `src/creature/CreatureTraining.ts`: the generation-1 predicate at each of the
  3 call sites (`generation === 0` / `generation === 1`) arms only for
  generation 1. Each site was red-checked alone, as listed above.
