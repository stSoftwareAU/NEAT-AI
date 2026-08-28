# ⏱️ Timeout Semantics — the T+15 Hard Cap

How long can an evolution run actually take? This document is the single source
of truth for the **`timeoutMinutes`** option and the **absolute hard cap** that
bounds `evolveDir` (and its siblings `evolveDataSet`, `evolveEnv`, `evolveRL`).

> [!IMPORTANT]
> **The guarantee in one line:** a run configured with `timeoutMinutes = T`
> returns within **`T + min(15, T)` minutes** of wall-clock — "T+15" for any
> `T ≥ 15` — abandoning in-flight work while keeping the best creature found so
> far. A run started with `--timeout=45` therefore finishes inside the hour,
> leaving the caller time for its normal save / model check-in.

## 🧩 The deadlines

Evolution tracks wall-clock deadlines anchored at the run's start timestamp:

| Deadline                        | Value                                       | Role                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Soft timeout** (`endTimeMS`)  | `start + max(1, T) × 60 000 ms`             | Stops starting _new_ generations once it passes. The loop then enters the finish-up phase and waits — briefly — for in-flight discovery / training to settle so their partial results are not wasted. |
| **Over-run** (GRQ #4141)        | `elapsed > T × factor` (default factor `1`) | Same generation-stop as the soft timeout, but an explicit self-termination path: the run finishes with the evolved population committed and does **not** wait for an external wall-clock cap.         |
| **Hard cap** (`hardDeadlineTS`) | `start + (T + grace) × 60 000 ms`           | The point of no return. Once it passes, every phase abandons in-flight work and the run returns. Nothing is allowed to push past it.                                                                  |

The grace period is clamped:

```text
grace = min(HARD_DEADLINE_GRACE_MINUTES, max(1, T))   // HARD_DEADLINE_GRACE_MINUTES = 15
```

So the grace never exceeds 15 minutes for long runs, and stays proportionate for
short ones (a 2-minute run gets at most 2 minutes of grace, not 15). When
`timeoutMinutes` is `0`/unset there is **no** soft timeout and **no** hard cap —
the run is bounded only by `iterations`, `targetError`, `SIGTERM`, and the
external watchdog. The canonical computation lives in
[`src/NEAT/HardDeadline.ts`](../src/NEAT/HardDeadline.ts)
(`computeHardDeadlineTS`).

## 🛑 What each phase does at the hard cap

The cap is enforced cooperatively — each phase checks the absolute
`hardDeadlineTS` at its own next safe boundary and stops there. None of them
waits past it.

- **Evolve loop** — `Neat.abandonInFlightPastHardDeadline(hardDeadlineTS)` is
  the first check in the finish-up branch. Once the cap has passed it clears
  `discoveryInProgress` / `trainingInProgress` (so the abandoned promises can
  never be re-awaited) and breaks the loop **unconditionally**, even when
  `finishUp()` would otherwise still ask for more wait generations. A stall
  _inside_ fitness is tracked as `inFlightPhase = "fitness"` so the watchdog
  reports `stalled in fitness` _while interrupting_, rather than
  `abandoning 0 in-flight task(s)` after the fact (GRQ #4141).
- **Generation loop** — the same check runs at the **top of every pass** of the
  loop, before any branch decides what to do next, so a generation that neither
  completed nor tripped the over-run predicate cannot start another one past the
  cap (GRQ #4470). Only the very first generation is exempt, so a run that
  starts already past its cap still commits one evolved population.
- **The generation itself** — `awaitWithinHardDeadline`
  ([`src/NEAT/HardDeadlineRace.ts`](../src/NEAT/HardDeadlineRace.ts)) bounds the
  `await neat.evolve()` itself. A discovery or training child that never settles
  can hold the resources the next generation needs; past the cap the wedged
  generation is abandoned (its late rejection swallowed), the population evolved
  so far is kept, and control returns to the caller — no hard kill (GRQ #4470).
- **Over-run** — independently of the hard cap, when elapsed exceeds
  `timeoutMinutes × factor` after at least one generation, the loop stops
  starting new generations and finishes with the population committed. This is
  graceful self-termination, not the hard-deadline abandon.
- **Finish-up wait** — `Neat.awaitInFlightTasks()` caps its own timeout at the
  time remaining before `hardDeadlineTS`, measured on the evolve loop's own
  clock. A never-resolving in-flight promise can therefore never wedge the wait
  past the cap, and once the wait returns instantly the loop-top check above
  ends the run instead of spinning on it.
- **Discovery** — the absolute `discoveryHardDeadlineTS` crosses the worker
  boundary (Issue #2898), so the worker clamps every per-discovery
  record/analysis deadline to the cap regardless of how long the request waited
  in the queue. The relative phase-split allocation (record vs analysis) still
  applies _inside_ that ceiling.
- **Training** — scheduled training tasks carry the same absolute hard deadline
  (Issue #2899) and are clamped to it.
- **Discovery replay** — `DiscoveryReplayQueue.scheduleReplay()` refuses to
  start a replay once the cap has passed, and
  `waitForCompletion(hardDeadlineTS)` drops any queued replay and signals the
  in-flight one to abort cooperatively at its next candidate boundary (Issue
  #2901).
- **Post-loop teardown** — everything that happens _after_ the loop breaks is
  bounded too (GRQ #4472): see
  [the next section](#-the-post-loop-teardown-is-bounded-too-grq-4472).

In every case the **partial results already gathered are kept** and the **best
creature found so far is loaded onto the caller's creature**, `creatureStore` is
written, and the run returns its normal `{ error, score, generation, time }`
summary. The cap costs you only the _unfinished_ work, never the finished work.

## 🧹 The post-loop teardown is bounded too (GRQ #4472)

Breaking out of the generation loop on time is only half of returning control to
the caller. After the loop breaks, `evolveDir` still has to terminate every
worker, drain the background replay queue, restore the champion and write the
checkpoint — and before GRQ #4472 each of those steps could block indefinitely.
A GRQ-22 `location` child was silent for ~2.5 h, which was equally consistent
with a wedge in the teardown as with one in the loop.

[`src/creature/BoundedEvolveTeardown.ts`](../src/creature/BoundedEvolveTeardown.ts)
is the single teardown shared by `evolveDir`, `evolveEnv` and `evolveRL`. It
runs three steps, in this order:

1. **Persist first.** The champion restore and the `creatureStore` write run
   _before_ anything that can block, so the evolved improvement is on disk even
   in the worst case. A failing write is logged and re-thrown — never swallowed
   — but only after the workers are down, so a failed checkpoint can neither
   hide nor leave a live pool behind.
2. **Terminate workers, on a budget.** A handler that throws, or one whose
   `terminate()` never settles, is detached and named in the log instead of
   waited on. Before this, one unguarded `terminate()` throw skipped the drain,
   the champion restore **and** the checkpoint write.
3. **Drain the replay queue, on a budget.** The queue's own cap only stops it
   starting _another_ replay, so a replay already in flight when the drain
   begins could outlive the cap entirely. The drain now ends no later than
   `max(hardDeadlineTS, now) + budget`; when it expires the in-flight replay is
   signalled to abort (`abandonInFlightReplay()`) and left running. An uncapped
   run (`timeoutMinutes` unset) keeps the unbounded Issue #1509 wait — with no
   deadline there is nothing to be late for.

The budget defaults to `DEFAULT_TEARDOWN_STEP_BUDGET_MS` (5 s) per step. The
teardown always emits **one summary line** naming what it left behind, so the
gap between a child's last log line and its exit is diagnosable rather than
silence:

```text
[evolveDir] teardown complete: 3 worker(s) terminated, 1 detached; replay queue
abandoned still-running — the process may stay alive until the detached work ends
```

> [!WARNING]
> **A bounded teardown makes `evolveDir` _return_ on time; it cannot make the
> Deno process _exit_ on time.** A worker wedged inside a synchronous native /
> WASM call never yields to its event loop, so `Worker.terminate()` returns
> immediately on the main thread but the worker thread is never reaped and the
> runtime will not exit. Measured directly on Deno 2.x: a main module that
> spawns a worker running `while (true) {}`, calls `terminate()` and then falls
> off the end **never exits** (killed at a 20 s timeout); the same program with
> a final `Deno.exit(0)` exits immediately.
>
> So a caller that must guarantee its own exit — GRQ's `location` children, for
> example — has to call `Deno.exit()` after `evolveDir` resolves rather than
> rely on natural exit. The teardown's warning line is the signal that this
> matters for a given run: it fires exactly when something was detached.

## 🤝 Cooperative return vs. forced abandon (Issue #3166)

A task asked to stop should **return on its own** within a small bounded grace
window — a _forced abandon_ is the failure mode, not the design. Two behaviours
keep the "Abandoning stuck training task(s)" force-cleanup path from firing in
normal runs:

- **A bounded grace cycle before force-abandon.** When the soft timeout passes,
  a worker that has hit its own per-task deadline has already returned
  cooperatively — but its result-handling callback (which removes the task from
  `trainingInProgress` / `discoveryInProgress`) runs as a microtask on the next
  finish-up cycle. `Neat.finishUp()` now grants **one** grace cycle after the
  wall-clock deadline passes, during which `awaitInFlightTasks()` drains those
  settled promises, so a cooperatively-returning task removes itself instead of
  being mislabelled "stuck" and force-abandoned the instant the deadline passes.
  Genuinely stuck tasks (whose promise never settles) are still abandoned — by
  the per-task stuck-task watchdog (`abandonStuckTrainingTasks`, Issue #3053)
  and, as a final backstop, on the next cycle after the grace — so the run
  always finalizes within a bounded window.
- **Sub-second training budgets are rejected, not silently run.**
  `scheduleTraining` computes each task's effective budget
  (`min(relative budget, hardDeadlineTS) − now`) up front. When that budget is
  below `MIN_TRAINING_BUDGET_MS` (1 s) the task is **skipped and flagged** with
  a warning rather than dispatched to a worker that could only "time out" in
  milliseconds. This surfaces mis-scaled budgets (the GRQ-16 run saw 16–93 ms
  budgets) and stops burning a worker slot near the hard deadline on a no-op.
  The pure helpers `computeEffectiveTrainingBudgetMs` and
  `isTrainingBudgetTooSmall` live in
  [`src/NEAT/PerTaskTrainingTimeout.ts`](../src/NEAT/PerTaskTrainingTimeout.ts).

## 🔀 How the deadline propagates

```mermaid
sequenceDiagram
    autonumber
    participant Caller
    participant evolveDir
    participant Neat
    participant Worker as Discovery/Training worker
    participant Replay as DiscoveryReplayQueue

    Caller->>evolveDir: evolveDir(timeoutMinutes = T)
    Note over evolveDir: start = now()<br/>endTimeMS = start + T·60s<br/>hardDeadlineTS = start + (T + min(15,T))·60s
    evolveDir->>Neat: new Neat(... hardDeadlineTS ...)

    loop each generation
        evolveDir->>Neat: abandonInFlightPastHardDeadline(hardDeadlineTS)<br/>(top of every pass — GRQ #4470)
        Neat->>Worker: scheduleDiscovery / scheduleTraining<br/>(carry hardDeadlineTS)
        Worker-->>Worker: clamp per-task deadline to min(local, hardDeadlineTS)
        Neat->>Replay: scheduleReplay(... hardDeadlineTS ...)
        alt the generation wedges behind a child that never settles
            evolveDir-->>evolveDir: awaitWithinHardDeadline → abandon it at the cap,<br/>keep the population evolved so far
        end
    end

    Note over evolveDir,Neat: soft timeout passes → finish-up phase
    evolveDir->>Neat: abandonInFlightPastHardDeadline(hardDeadlineTS)
    alt now > hardDeadlineTS
        Neat-->>Neat: clear discoveryInProgress + trainingInProgress
        Neat-->>evolveDir: true → break the loop
    else still before the cap
        evolveDir->>Neat: awaitInFlightTasks() (capped at hardDeadlineTS)
    end

    Note over evolveDir: bounded teardown (GRQ #4472)
    evolveDir-->>evolveDir: 1. load best creature + write creatureStore
    evolveDir->>Worker: 2. terminate() — budgeted; detach what will not stop
    evolveDir->>Replay: 3. waitForCompletion(hardDeadlineTS) — budgeted
    Replay-->>Replay: drop queued replay, abort in-flight at next boundary
    evolveDir->>Caller: teardown summary line, then return
```

The data flow, in one line:

```text
evolveDir → Neat.hardDeadlineTS → scheduleDiscovery / scheduleTraining / replay queue → worker clamps
```

## 🛰️ The external watchdog is unchanged

The T+15 hard cap is an **in-process** guarantee. The external watchdog — for
example GRQ's 3-hour `max-task-hours` — remains the independent backstop and is
**unchanged** by any of this. The cap exists so that, in the normal case, a run
finishes and checks its model in _well before_ the watchdog ever has to fire;
the watchdog only catches pathological situations (a wedged process, a deadlock
outside the cooperative checkpoints) that an in-process deadline cannot reach.

## ✅ Verifying the guarantee

The end-to-end guard
[`test/creature/EvolveDirHardDeadline.ts`](../test/creature/EvolveDirHardDeadline.ts)
drives `evolveDir` with a tiny `timeoutMinutes` and stubbed never-resolving
discovery / training work, with the cap placed in the past via an injected start
timestamp (so the assertions are behavioural, never elapsed-time measurements —
the policy from Issue #2888). It asserts the run **returns**, the best creature
is loaded onto the caller's creature, `creatureStore` is written and loadable,
and the in-flight maps are empty. The replay-queue hard-cap bound has dedicated
coverage in
[`test/NEAT/DiscoveryReplayQueueDeadline.ts`](../test/NEAT/DiscoveryReplayQueueDeadline.ts).

The bounded teardown has its own two layers:
[`test/creature/BoundedEvolveTeardown.ts`](../test/creature/BoundedEvolveTeardown.ts)
unit-covers each branch with an injected clock, and
[`test/creature/EvolveDirBoundedTeardown.ts`](../test/creature/EvolveDirBoundedTeardown.ts)
drives `evolveDir` end to end with a worker whose `terminate()` never resolves,
one whose `terminate()` throws, and a replay drain that never settles —
asserting in every case that the run returns and the champion still reaches
`creatureStore`.

## 🔗 Related

- [`src/NEAT/HardDeadline.ts`](../src/NEAT/HardDeadline.ts) — the pure
  `computeHardDeadlineTS` helper, `HARD_DEADLINE_GRACE_MINUTES`, and the
  over-run helpers (`hasTrainingOverrun`, `shouldStopStartingGenerations`).
- [`src/discovery/DiscoveryTimeout.ts`](../src/discovery/DiscoveryTimeout.ts) —
  `remainingTaskBudgetMinutes` honours `GRQ_TASK_DEADLINE_EPOCH` /
  `GRQ_TASK_MAX_SECONDS` when GRQ's `run_core.sh` exported them, and
  `resolveWallClockBudgetMinutes` applies it as a **clamp only**
  (`min(timeOutMinutes, envBudgetMinutes ?? timeOutMinutes)`, GRQ #4471): the
  env budget may shorten a discovery plan, never widen one past the
  `timeoutMinutes` the caller asked for.
- [CONFIGURATION_GUIDE.md](CONFIGURATION_GUIDE.md) — the full configuration
  surface, including `timeoutMinutes`.
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — what to do when a run does not stop
  when you expect it to.
