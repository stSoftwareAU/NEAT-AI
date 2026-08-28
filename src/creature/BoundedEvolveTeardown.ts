/**
 * BoundedEvolveTeardown.ts — bounded post-loop teardown (GRQ #4472, part of
 * GRQ #4469).
 *
 * Breaking out of the evolve generation loop on time is only half of returning
 * control to the caller. After the loop breaks, `evolveDir` (and its `evolveEnv`
 * / `evolveRL` siblings) still has to terminate every worker, drain the
 * background discovery replay queue, restore the champion and write the
 * checkpoint. Every one of those steps could block indefinitely:
 *
 *  - `WorkerHandler.terminate()` was called unguarded, so a handler that threw
 *    (or handed back a promise that never settles) skipped the replay drain,
 *    the champion restore **and** `writeCreatures` — the evolved improvement was
 *    lost along with the run.
 *  - `DiscoveryReplayQueue.waitForCompletion(hardDeadlineTS)` only consults its
 *    cap *between* replays. Enter it before the cap with a replay that never
 *    settles and the `await` is unbounded — exactly the shape of the GRQ-22
 *    child that went silent for ~2.5 h.
 *
 * This module makes the teardown itself bounded, so "the loop ended on time"
 * always translates into "the process returned on time":
 *
 *  1. **Persist first.** The champion restore and the checkpoint write run
 *     before anything that can block, so completed work reaches disk even in
 *     the worst case.
 *  2. **Bound each blocking step.** Worker termination and the replay drain get
 *     a short, explicit budget. Detaching something we cannot stop is
 *     acceptable; hanging on it is not.
 *  3. **Say what was left behind.** One summary line names every abandoned
 *     step, so a future silent-child log is diagnosable rather than a mystery.
 *
 * The clock is injectable and the deadline is polled (never armed as a single
 * `setTimeout`), so tests drive every branch with no real waits — the
 * behavioural-test policy from #2888.
 */

import {
  awaitWithinHardDeadline,
  HARD_DEADLINE_BREACHED,
} from "@neat/HardDeadlineRace.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Default budget, in milliseconds, for each blocking teardown step.
 *
 * Short enough that a wedged worker or replay cannot meaningfully extend the
 * run past its hard deadline, long enough for an orderly termination and for a
 * cooperative replay to notice its abort signal.
 */
export const DEFAULT_TEARDOWN_STEP_BUDGET_MS = 5_000;

/** How often a teardown budget is polled while a step is in flight. */
export const TEARDOWN_POLL_INTERVAL_MS = 50;

/**
 * The worker surface teardown needs. `WorkerHandler.terminate()` returns
 * `void`, but the contract allows a promise so an implementation that cannot
 * stop promptly is bounded rather than awaited forever.
 */
export interface TerminableWorker {
  terminate(): void | Promise<unknown>;
}

/** The replay-queue surface teardown needs — satisfied by `DiscoveryReplayQueue`. */
export interface ReplayDrainQueue {
  waitForCompletion(hardDeadlineTS?: number): Promise<void>;
  isReplayInProgress(): boolean;
  /** Optional cooperative abandon used when the drain budget expires. */
  abandonInFlightReplay?(): boolean;
}

/** What the teardown actually managed to do — returned for tests and callers. */
export interface BoundedEvolveTeardownReport {
  /** Workers whose `terminate()` completed inside the budget. */
  workersTerminated: number;
  /** Workers left detached: `terminate()` threw or outlived the budget. */
  workersAbandoned: number;
  /** True when the replay queue drained inside its budget. */
  replayDrained: boolean;
  /** True when the in-flight replay was signalled to abort and left running. */
  replayAbandoned: boolean;
}

/** Inputs to {@link runBoundedEvolveTeardown}. */
export interface BoundedEvolveTeardownOptions {
  /** Entry point being torn down (`"evolveDir"`, …) — used in log lines. */
  label: string;
  /**
   * Champion restore + checkpoint write. Runs **first** and unbounded so the
   * evolved improvement is on disk before any step that can block. A failure
   * is logged, the rest of the teardown still runs, and the error is re-thrown
   * once the workers are down — never swallowed.
   */
  persist: () => Promise<void>;
  /** Worker handlers to terminate. Empty/omitted is a no-op. */
  workers?: readonly TerminableWorker[];
  /** Background replay queue to drain. */
  replayQueue: ReplayDrainQueue;
  /**
   * The run's absolute hard cap (epoch ms), or 0 when no timeout was
   * configured. An uncapped run keeps the unbounded Issue #1509 drain: with no
   * deadline there is nothing to be late for, and callers that delete the data
   * directory afterwards still need the replay finished.
   */
  hardDeadlineMS: number;
  /** Clock, injectable for tests (#2888). Defaults to `Date.now`. */
  now?: () => number;
  /** Per-step budget. Defaults to {@link DEFAULT_TEARDOWN_STEP_BUDGET_MS}. */
  budgetMS?: number;
  /** Deadline poll interval. Defaults to {@link TEARDOWN_POLL_INTERVAL_MS}. */
  pollIntervalMS?: number;
}

/** A positive, finite budget; anything else falls back to the default. */
function normaliseBudget(budgetMS: number | undefined): number {
  return budgetMS !== undefined && Number.isFinite(budgetMS) && budgetMS > 0
    ? budgetMS
    : DEFAULT_TEARDOWN_STEP_BUDGET_MS;
}

/**
 * Invoke `terminate()`, returning the promise to bound, `undefined` when it
 * completed synchronously, or the thrown error.
 *
 * A synchronous `terminate()` — what a production Deno `Worker` does — needs no
 * race at all, so the common path stays allocation-free.
 */
function beginTerminate(
  worker: TerminableWorker,
): { pending?: Promise<unknown>; error?: unknown } {
  try {
    const outcome = worker.terminate();
    return outcome === undefined || outcome === null
      ? {}
      : { pending: Promise.resolve(outcome) };
  } catch (error) {
    return { error };
  }
}

/**
 * Terminate every worker, giving the whole step one shared budget.
 *
 * A worker that throws, or whose `terminate()` outlives the budget, is counted
 * as abandoned and named in the log rather than waited on. Termination is not
 * cancellable, so an abandoned worker keeps running — the caller's process may
 * therefore outlive this function, which is why the abandon is logged loudly.
 */
async function terminateWorkers(
  label: string,
  workers: readonly TerminableWorker[],
  now: () => number,
  budgetMS: number,
  pollIntervalMS: number,
): Promise<{ terminated: number; abandoned: number }> {
  let terminated = 0;
  let abandoned = 0;
  if (workers.length === 0) return { terminated, abandoned };

  const deadlineMS = now() + budgetMS;

  for (let i = workers.length; i--;) {
    const { pending, error } = beginTerminate(workers[i]);
    if (error !== undefined) {
      abandoned++;
      getLogger().warn(
        `[${label}] teardown: worker ${i} terminate() failed — detaching it ` +
          `and continuing`,
        error,
      );
      continue;
    }
    if (pending === undefined) {
      terminated++;
      continue;
    }
    // deno-lint-ignore no-await-in-loop
    const outcome = await awaitWithinHardDeadline(
      pending,
      deadlineMS,
      now,
      () => {
        getLogger().warn(
          `[${label}] teardown: worker ${i} did not stop within the ` +
            `${budgetMS} ms budget — detaching it and continuing`,
        );
      },
      pollIntervalMS,
    );
    if (outcome === HARD_DEADLINE_BREACHED) {
      abandoned++;
    } else {
      terminated++;
    }
  }

  return { terminated, abandoned };
}

/**
 * Drain the background replay queue within a bounded budget.
 *
 * The queue's own cap only stops it starting *another* replay, so a replay
 * already in flight when the drain begins can outlive the cap entirely. The
 * drain therefore ends no later than `max(hardDeadline, now) + budget`; when it
 * expires the in-flight replay is signalled to abort and left running.
 *
 * An uncapped run (`hardDeadlineMS === 0`) keeps the unbounded Issue #1509
 * wait — there is no deadline to be late for.
 */
async function drainReplayQueue(
  label: string,
  queue: ReplayDrainQueue,
  hardDeadlineMS: number,
  now: () => number,
  budgetMS: number,
  pollIntervalMS: number,
): Promise<{ drained: boolean; abandoned: boolean }> {
  const drainDeadlineMS = hardDeadlineMS > 0
    ? Math.max(hardDeadlineMS, now()) + budgetMS
    : 0;

  const drain = queue
    .waitForCompletion(hardDeadlineMS || undefined)
    .catch((error: unknown) => {
      getLogger().error(
        `[${label}] teardown: replay queue drain failed`,
        error,
      );
    });

  const outcome = await awaitWithinHardDeadline(
    drain,
    drainDeadlineMS,
    now,
    () => {
      getLogger().warn(
        `[${label}] teardown: replay queue still draining after the ` +
          `${budgetMS} ms budget — signalling abort and continuing`,
      );
    },
    pollIntervalMS,
  );

  if (outcome !== HARD_DEADLINE_BREACHED) {
    return { drained: true, abandoned: false };
  }

  queue.abandonInFlightReplay?.();
  return { drained: false, abandoned: true };
}

/**
 * Run the bounded post-loop teardown shared by `evolveDir`, `evolveEnv` and
 * `evolveRL`.
 *
 * Order matters: persist, then terminate workers, then drain the replay queue.
 * Persisting first is what protects the evolved improvement — every later step
 * can be abandoned without losing it.
 *
 * @throws Whatever `persist` threw, re-thrown after the workers are down so a
 *         failed checkpoint write is loud and still leaves nothing running.
 */
export async function runBoundedEvolveTeardown(
  options: BoundedEvolveTeardownOptions,
): Promise<BoundedEvolveTeardownReport> {
  const now = options.now ?? Date.now;
  const budgetMS = normaliseBudget(options.budgetMS);
  const pollIntervalMS = options.pollIntervalMS ?? TEARDOWN_POLL_INTERVAL_MS;
  const label = options.label;

  // 1. Persist before anything that can block: a wedged worker or replay must
  //    never cost us the generations already evolved.
  let persistError: unknown;
  let persistFailed = false;
  try {
    await options.persist();
  } catch (error) {
    persistError = error;
    persistFailed = true;
    getLogger().error(
      `[${label}] teardown: persisting the evolved best creature failed`,
      error,
    );
  }

  // 2. Workers, on a shared budget.
  const { terminated, abandoned } = await terminateWorkers(
    label,
    options.workers ?? [],
    now,
    budgetMS,
    pollIntervalMS,
  );

  // A failed persist is re-thrown here — after the workers are down, so the
  // caller is not left with a live pool, and before the replay drain, which
  // exists only to protect work this run can no longer produce.
  if (persistFailed) {
    throw persistError;
  }

  // 3. Replay queue, on its own budget.
  const { drained, abandoned: replayAbandoned } = await drainReplayQueue(
    label,
    options.replayQueue,
    options.hardDeadlineMS,
    now,
    budgetMS,
    pollIntervalMS,
  );

  const report: BoundedEvolveTeardownReport = {
    workersTerminated: terminated,
    workersAbandoned: abandoned,
    replayDrained: drained,
    replayAbandoned,
  };

  // 4. One summary line. GRQ-22 was diagnosable only as "silence"; a run that
  //    leaves something behind now says so at the moment it hands back control.
  const summary = `[${label}] teardown complete: ` +
    `${terminated} worker(s) terminated, ${abandoned} detached; ` +
    `replay queue ${drained ? "drained" : "abandoned still-running"}`;
  if (abandoned > 0 || replayAbandoned) {
    getLogger().warn(
      `${summary} — the process may stay alive until the detached work ends`,
    );
  } else {
    getLogger().info(summary);
  }

  return report;
}
