# 🚪 Process Does Not Exit After `evolveDir`

This document covers a run that finishes its work but whose process never exits:
the evolve call has returned, yet the terminal never comes back. See the index
in [`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) for other categories.

## Symptom

**Symptom:** The log shows a worker was quarantined earlier in the run, for
example `[worker-N] quarantined`. The evolve call then returns, but the process
stays alive and silent until an external watchdog, a timeout, or Ctrl-C kills
it.

## Cause

A quarantined worker is one that missed its per-task deadline.
`Worker.terminate()` can only stop a worker at a JavaScript boundary. A thread
blocked in a synchronous native (FFI) call cannot be interrupted that way, and
Deno keeps the event loop, and therefore the process, alive for that thread. The
script ends but the process does not.

Two native calls have been the source of such a thread:

- **The native trainer on a legacy engine.** `trainDir` runs its training in a
  synchronous native call. An engine that does not advertise the native deadline
  capability (`neat_ai_backpropagation` 0.1.49 or earlier) is never sent the
  deadline, so it does not stop on it, and a wedged training call can pin the
  process. A deadline-capable engine (0.1.50 or later) stops within an epoch. To
  see which backend a hung task ran and whether it was sent a deadline, grep the
  parent log for `[training-backend]` (Issue #4146). For a native task,
  `[training-phase]` lines then show whether the native call returned
  (`phase=native-returned`, written as soon as it does) and whether packaging
  and finalisation finished (`phase=finalised`). See
  [the native trainer and the per-task deadline](../TIMEOUTS.md#-the-native-trainer-and-the-per-task-deadline-issue-4119).
- **Discovery analysis, until Issue #4126.** `analyze_parallel` was also a
  synchronous native call, so a stuck discovery analysis pinned the process in
  the same way. It is now declared `nonblocking: true`. The worker's thread is
  no longer blocked, so a stuck discovery analysis no longer prevents the
  process from exiting. The native analysis cannot be cancelled from JavaScript;
  it ends at its Rust-side deadline or when `cancel_analysis_memory_pressure()`
  is signalled under memory pressure.

```mermaid
sequenceDiagram
    participant App as Your script
    participant Evolve as evolveDir
    participant Pool as WorkerPool
    participant W as Quarantined worker
    Evolve->>W: deadline missed, quarantine
    Evolve->>Pool: terminate workers
    Pool->>W: Worker.terminate()
    Note over W: blocked in native code, not stopped
    Evolve->>Evolve: teardown warns N worker(s) could not be stopped
    Evolve-->>App: evolve call returns
    Note over App,W: Deno keeps the process alive for the thread
    App->>App: exitOnUnreclaimableWorkers: Deno.exit() after 10 s grace
```

## Diagnose

The teardown reports the workers it could not stop with a warning line:

```text
teardown: N worker(s) could not be stopped
```

The internal teardown report carries a `workersUnreclaimable` field for the same
workers. It is not part of the public API, so the warning line is the signal to
look for.

## Fix

### Option 1: `exitOnUnreclaimableWorkers`

Set `exitOnUnreclaimableWorkers: true` and, for `evolveDir`, the library exits
the process for you when such workers remain:

```ts
import { createNeatConfig } from "@stsoftware/neat-ai";

const config = createNeatConfig({
  exitOnUnreclaimableWorkers: true, // default: false
});
```

When `true`, and `evolveDir` returns or throws while a worker could not be
stopped, the library arms a guard that calls `Deno.exit()` 10 seconds after
teardown. A worker counts as not stopped if it was quarantined or terminated
while a task was still unanswered, whether cancelled or not, or if it was
detached because `terminate()` threw or outlived the teardown budget. The exit
preserves `Deno.exitCode`, so the exit status is the one your script set. The
guard is armed only in that case.

The option takes effect in `evolveDir`, the entry point that schedules
native-trainer and discovery tasks. It is accepted but has no effect in
`evolveEnv` or `evolveRL` today: `evolveEnv` has no worker pool, and
`evolveRL`'s EpisodeWorkerPool does not report unstoppable workers. A process
that hangs after `evolveEnv` or `evolveRL` therefore needs Option 2.

The default is `false`, because a library should not exit its host unasked. Only
enable it in a script that has nothing left to do after `evolveDir` returns, or
that finishes within the 10-second grace period.

### Option 2: explicit `Deno.exit()` after cleanup

If your script owns its own exit, finish your own work first and then exit
explicitly:

```ts
const creature = await network.evolveDir(dir, options);
await saveResults(creature); // your own cleanup, awaited
Deno.exit(0);
```

`Deno.exit()` ends the process immediately, so any work not yet flushed is lost.
Await everything you need before you call it.

## See also

- [Workers and parallel evaluation](../config/WORKERS.md) — the
  `exitOnUnreclaimableWorkers` option and the rest of the worker pool options.
- [Timeouts](../TIMEOUTS.md) — how the per-task deadline and quarantine work.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
