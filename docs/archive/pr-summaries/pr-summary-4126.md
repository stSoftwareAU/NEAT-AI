## Summary

Let `evolveDir` return and its caller exit naturally after quarantining native
training. Workers await training, retain native buffers and code safely, and
keep native-enabled single-thread runs out of the main isolate. Part of #4126.

## Spec

### Intent and Rationale

- A synchronous FFI call prevents worker termination. Awaiting it permits the
  isolate to terminate while native computation continues.
- That alone is unsafe: Deno can unload the worker's library before the native
  call returns. C-heap buffers and OS loader references protect late native
  reads, writes and execution.

### Essential Design Decisions

- Keep synchronous `trainDir`, deadline validation, native errors and result
  packaging shared with the asynchronous worker path.
- Native-enabled `evolveDir` uses real workers even with `threads: 1`, and
  refuses an in-process fallback after worker initialisation failure. WASM-only
  direct execution and its fallback remain available.
- Completed calls release their native resources. Termination abandons C
  allocations, allocator/library references and native state until process exit;
  temporary directories can remain on disk. Native computation is not cancelled.
- Preserve the existing opt-in exit guard and its exit-code handling. Unanswered
  tasks remain a conservative warning, rather than proof the process cannot
  exit.

### Undiscoverable Facts

- Local runtime verdict: **single-host**, `vibe-coder-3644`, Linux arm64, Deno
  2.9.8, 2026-11-13 UTC. This is not fleet-wide deployment verification.
- A C probe without retained code unloaded its pending library and exited with
  SIGSEGV when released. The retained-library late-return regression exits 0.
- The downstream mitigation is already delivered in GRQ; its issue is closed.
  NEAT-AI #4146 remains open for the separate native deadline-overrun
  recurrence.

## Evidence

Backend/CLI changes only; no visual surface changed.

- `test/creature/EvolveDirNativeProcessExit.ts` exercises real `evolveDir`,
  scheduling, worker processing, watchdog abandonment and teardown. The child
  arms the run watchdog, advances the task watchdog past its recorded deadline
  plus grace, and prints its final statement with the exit guard disabled.
- The final regression fails against `origin/Develop` (`e275a827`): training
  enters C, is quarantined, `evolveDir` returns, `CALLER_LAST_STATEMENT` prints,
  and the process still requires the 30-second watchdog kill. It passes with
  this implementation. The single-thread variant also exposed a pending FFI
  operation left in the main isolate by the asynchronous checkpoint, and now
  passes after real-worker isolation.
- Ownership was checked against Deno's
  [2.7 nonblocking FFI implementation](https://github.com/denoland/deno/blob/v2.7.0/ext/ffi/call.rs)
  and
  [library resource lifetime](https://github.com/denoland/deno/blob/v2.9.8/ext/ffi/dlfcn.rs).
  The C fixture tests late reads/writes after termination; CLI cases verify the
  trainer process is no longer running.
- [GRQ PR #5494](https://github.com/stSoftwareAU/GRQ/pull/5494), merged as
  `df3c887b5`, sets the shared options flag and applies it in `Learn.ts`.
  Verified the four EvolveApp callers and FX's additional options at GRQ
  `f0a8e225`; they preserve the opt-in.
- Issue provenance checked: #4126 — Process never exits after evolveDir returns
  following a worker quarantine; #4146 — Recurrence of #4119 on 7.1.12 + engine
  0.1.50; [GRQ #5479](https://github.com/stSoftwareAU/GRQ/issues/5479) — GRQ
  ignores NEAT-AI's 'call Deno.exit()' teardown warning (closed).

```mermaid
flowchart LR
    A[Scheduled native training] --> B[Await inside a real worker]
    B --> C[Deadline and quarantine]
    C --> D[Terminate worker isolate]
    D --> E[evolveDir returns]
    E --> F[Caller cleanup and natural exit]
```

## Reproduction

- **symptom** — the caller runs its final statement after a training quarantine,
  but the hosting process does not exit.
- **status** — `partial` — observed failing on base and passing after the fix;
  reason: native blocking uses a C ABI stand-in and the task clock is advanced
  deterministically. The original fleet model and native-engine overrun were not
  reproduced.
- **regression test** —
  `test/creature/EvolveDirNativeProcessExit.ts::evolveDir exits after scheduled native training is quarantined without the exit guard`.

## Acceptance Criteria

These are executor assessments. Independent reviewer agents were not run because
this executor was explicitly instructed: 'Do not delegate'. No independent
review provenance is claimed.

- **met** — Reproduce: a test where one scheduled training task blocks
  synchronously, past its deadline (e.g. a stub FFI/CLI trainer or a worker
  busy-loop), gets quarantined, and `evolveDir` then returns. Assert that the
  hosting deno process **exits within a bounded time** (e.g. 30 s) after the
  caller's last statement. This is the regression test that would have caught
  it. — evidence: `test/creature/EvolveDirNativeProcessExit.ts`, including FFI
  and CLI cases with one and two workers, plus a late native return.
- **met** — Fix in neat-ai so a quarantined/terminated worker or watchdog can't
  pin the process. If a thread genuinely can't be reclaimed, `evolveDir` should
  report it (e.g. `[evolveDir] teardown: N worker(s) could not be stopped`) so
  callers can exit explicitly. — evidence:
  `src/architecture/training/NativeBackpropLibrary.ts`,
  `src/creature/CreatureTraining.ts`, `src/creature/BoundedEvolveTeardown.ts`,
  and the process regressions above.
- **met** — In GRQ, separately: the `EvolveApp`s can end with an explicit
  `Deno.exit(0)` after cleanup as a belt-and-braces guard. That is a mitigation,
  not this fix. — evidence: GRQ PR #5494 and the verified callers; reason: the
  separately delivered mitigation opts callers into the existing exit guard
  instead of adding an exit call to every app. This PR changes no GRQ code.
- **missing** — Closing evidence: a quoted fleet log showing a quarantine
  (`[worker-N] quarantined`) followed by the unit's
  `[phase] ✔ END industry-evolve` (or equivalent) within a minute of
  `Cleaned up .tmp/train`. — reason: no such sequence was found in the sampled
  archive. Inspected all six artifacts at GRQ-logs `ca28e2ab`, plus GRQ-3-sloth
  snapshots `fda98f17`, `c2c49587` and `ebf0de9f` from 8–10 November. These
  samples do not establish fleet-wide behaviour, and this implementation has not
  been deployed there.

## Standards Review

Executor self-review only, as required by the no-delegation instruction.

- Checked native buffer/code lifetime, concurrent close, synchronous
  compatibility, error causes, subprocess termination, isolated temporary paths,
  Australian English, import consolidation, and tests through production
  callers.
- New production exports have production callers. Async/sync validation and
  response handling share implementations; typed FFI declarations constrain the
  matching symbol definitions. No persisted JSON shape changed.
- Existing base-branch test assertions were not removed. Tests assert results,
  failures and process outcomes, with no performance thresholds or source-text
  inspection added.

## Test Plan

- [x] `test/creature/EvolveDirNativeProcessExit.ts`: five process cases, with
      native entry, quarantine, return and final-statement controls; FFI late
      completion stays safe and CLI children stop running.
- [x] `test/creature/EvolveDirNativeWorkerInit.ts`: native initialisation
      failure refuses a mock fallback; WASM direct and fallback controls
      complete.
- [x] `test/architecture/training/NativeTrainingWorkerResults.ts`: FFI/CLI
      completion and errors, trained genome/metrics, FFI request identity/data
      path, legacy deadline omission and completed/failed FFI work-directory
      cleanup.
- [x] `test/architecture/training/NativeBackpropTrainNonBlocking.ts`,
      `test/architecture/training/NativeHeap.ts`, and
      `test/architecture/training/TrainDirAsync.ts`: deadline
      forwarding/refusals, native errors, pending concurrent close, independent
      C memory and synchronous result compatibility. Doubles replay the
      committed native response captures; the C fixture does not compute
      gradients.
- [x] Full `./quality.sh` with `DENO_JOBS=1`, `QUALITY_TRACE_LEAKS=0`, and
      `NEAT_AI_RUST_SCORER_BINARY_PATH` selecting a scorer built from
      NEAT-AI-scorer `742c5df3`: **10,347 passed (5 steps), 50 ignored, 0
      failed**. This passed before a type-only import consolidation; formatter,
      linter, type-checker and 45 regression tests passed after that
      consolidation, including `test/creature/NeuronUuidStability.ts` and
      `test/creature/SemanticVersionStability.ts`.
- Documentation sweep covered the worker exit section, troubleshooting cause and
  diagnostics, timeout teardown warning, internal training API, historical
  memory measurement, and native fixture contract. Updated
  `docs/config/WORKERS.md`, `docs/troubleshooting/PROCESS_DOES_NOT_EXIT.md`,
  `docs/TIMEOUTS.md`, `docs/api/TRAINING.md`, `docs/troubleshooting/MEMORY.md`,
  `test/fixtures/native-backprop/README.md`, and `CHANGELOG.md`.

## Deno regression avoided

Used Deno workers, FFI and subprocess APIs with the existing dependencies. No
Node tooling was introduced.

## Merge verification

CI and independent code review are pending.

Not checked: qualifying deployed fleet logs, the original native-engine deadline
recurrence, macOS/Windows, and older Deno runtime execution. Native computation
can continue after quarantine, retaining memory until process exit and leaving
temporary directories on disk.
