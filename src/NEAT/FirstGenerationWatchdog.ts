/**
 * Off-thread first-generation watchdog (Issue #4060).
 *
 * Issue #4053 bounds generation 1 with `awaitWithinHardDeadline`, a
 * `setInterval` poll that runs on the SAME JavaScript event loop as the work it
 * bounds. With `threads: 1` the training and fitness work runs in-process (via
 * the mock worker) on the main thread; if that work blocks the thread
 * synchronously, the poll never gets a turn, the bound never fires, and the run
 * hangs silently for hours.
 *
 * This watchdog lives in a Deno Worker, so it keeps its own event loop and its
 * own clock. It is armed before generation 1's `neat.evolve()` is called and
 * disarmed (the worker is terminated) when that await settles. If it is still
 * armed `slackMS` after the first-generation bound, the in-process bound has
 * demonstrably failed to act: the worker logs the wedge and sends SIGKILL to
 * the process. SIGKILL is deliberate: a worker's `Deno.exit()` only closes the
 * worker, and SIGTERM is intercepted by `evolveDir`'s signal listener, which
 * cannot run while the main thread is blocked.
 *
 * This module stays import-light because the worker entry imports it.
 */

import { HARD_DEADLINE_WATCHDOG_INTERVAL_MS } from "./HardDeadline.ts";

/**
 * How long past the first-generation bound the off-thread watchdog waits for
 * the in-process bound to act before it terminates the process (Issue #4060).
 */
export const FIRST_GENERATION_WATCHDOG_SLACK_MS = 60_000;

/** Message the main thread posts to the watchdog worker. */
export interface FirstGenerationWatchdogRequest {
  /** Run start (epoch ms) — the elapsed time in the log line is measured from it. */
  startMS: number;
  /** Absolute first-generation bound (epoch ms). */
  deadlineMS: number;
  /** Extra wait past `deadlineMS` before firing. */
  slackMS: number;
  /** How often the worker checks its clock. */
  pollIntervalMS: number;
}

/**
 * Side effects of firing, injectable so the decision is unit-testable without
 * killing the test process.
 */
export interface FirstGenerationWatchdogActions {
  log: (line: string) => void;
  kill: () => void;
}

/** True once `nowMS` is strictly past `deadlineMS + slackMS`. */
export function isFirstGenerationWatchdogDue(
  nowMS: number,
  request: Pick<FirstGenerationWatchdogRequest, "deadlineMS" | "slackMS">,
): boolean {
  return nowMS > request.deadlineMS + request.slackMS;
}

/** Log the wedged line, then terminate. Never throws. */
export function fireFirstGenerationWatchdog(
  nowMS: number,
  request: Pick<FirstGenerationWatchdogRequest, "startMS">,
  actions: FirstGenerationWatchdogActions,
): void {
  const elapsedSeconds = Math.round((nowMS - request.startMS) / 1000);
  try {
    actions.log(
      `[Neat] First generation wedged after ${elapsedSeconds}s (first-generation bound passed while the main thread was not yielding, so the in-process bound could not fire) — terminating the process with SIGKILL; terminationReason first-generation-wedged, no generation was evolved`,
    );
    actions.kill();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      actions.log(
        `[Neat] First-generation watchdog could not terminate the process: ${message} — the caller must enforce timeoutMinutes + the first-generation bound as a hard kill`,
      );
    } catch {
      // Nothing left to report to; never throw from the watchdog.
    }
  }
}

/** Handle to an armed watchdog. */
export interface FirstGenerationWatchdog {
  disarm(): void;
}

/**
 * Arm the off-thread watchdog; returns undefined (nothing spawned) when
 * `deadlineMS` is 0 (no timeout configured, so no bound).
 */
export function armFirstGenerationWatchdog(
  startMS: number,
  deadlineMS: number,
  slackMS: number = FIRST_GENERATION_WATCHDOG_SLACK_MS,
): FirstGenerationWatchdog | undefined {
  if (!deadlineMS) return undefined;
  const worker = new Worker(
    new URL("./FirstGenerationWatchdogWorker.ts", import.meta.url).href,
    { type: "module", name: "first-generation-watchdog" },
  );
  const request: FirstGenerationWatchdogRequest = {
    startMS,
    deadlineMS,
    slackMS,
    pollIntervalMS: HARD_DEADLINE_WATCHDOG_INTERVAL_MS,
  };
  worker.postMessage(request);
  return { disarm: () => worker.terminate() };
}

/**
 * Run `run` with the watchdog armed for its whole duration, including the
 * synchronous prefix of whatever `run` calls; disarms on settle or throw.
 */
export async function withFirstGenerationWatchdog<T>(
  startMS: number,
  deadlineMS: number,
  slackMS: number | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const watchdog = armFirstGenerationWatchdog(
    startMS,
    deadlineMS,
    slackMS ?? FIRST_GENERATION_WATCHDOG_SLACK_MS,
  );
  try {
    return await run();
  } finally {
    watchdog?.disarm();
  }
}
