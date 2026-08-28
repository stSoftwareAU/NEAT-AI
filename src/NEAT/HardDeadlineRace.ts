/**
 * Hard-deadline race helper — GRQ #4470, part of GRQ #4469.
 *
 * `computeHardDeadlineTS` (see `HardDeadline.ts`) says *when* a run must be
 * over; this module makes an `await` inside the evolve loop obey it. A
 * generation that wedges behind a discovery or training child that never
 * settles would otherwise pin the loop inside `neat.evolve()`, so no branch of
 * the loop is ever reached again and the run outlives its own cap until an
 * external watchdog kills it — throwing away the work already completed.
 *
 * The deadline is polled with an injectable clock rather than armed as a
 * single `setTimeout`, so tests drive it with an injected clock and no real
 * waits (policy #2888), and a caller that advances its clock in jumps is still
 * caught within one poll interval.
 */

import { HARD_DEADLINE_WATCHDOG_INTERVAL_MS } from "./HardDeadline.ts";

/**
 * Returned by {@link awaitWithinHardDeadline} when the hard deadline passed
 * before the awaited work settled. A unique symbol so it can never collide
 * with a legitimate result value.
 */
export const HARD_DEADLINE_BREACHED: unique symbol = Symbol(
  "hard-deadline-breached",
);

/** Outcome of {@link awaitWithinHardDeadline}: the work's value, or the breach. */
export type HardDeadlineOutcome<T> = T | typeof HARD_DEADLINE_BREACHED;

/**
 * Await `work`, but give up at `hardDeadlineMS` and return
 * {@link HARD_DEADLINE_BREACHED} instead of waiting forever.
 *
 * Abandoning the work is deliberate: `work` is left running (there is no way
 * to cancel a promise), its rejection is swallowed so an abandoned generation
 * cannot surface as an unhandled rejection, and the caller decides what to
 * salvage. `onBreach` is invoked exactly once, at the moment the deadline is
 * observed, so the abandon is logged when it happens rather than after the
 * fact.
 *
 * @param work            The in-flight work to bound.
 * @param hardDeadlineMS  Absolute cap (epoch ms). 0/unset = no cap: `work` is
 *                        awaited unchanged.
 * @param now             Clock, injectable for tests (#2888).
 * @param onBreach        Invoked once when the deadline is observed first.
 * @param pollIntervalMS  How often the deadline is checked.
 */
export async function awaitWithinHardDeadline<T>(
  work: Promise<T>,
  hardDeadlineMS: number,
  now: () => number,
  onBreach: () => void,
  pollIntervalMS: number = HARD_DEADLINE_WATCHDOG_INTERVAL_MS,
): Promise<HardDeadlineOutcome<T>> {
  if (!hardDeadlineMS) {
    return await work;
  }

  let pollId: ReturnType<typeof setInterval> | undefined;
  const breached = new Promise<typeof HARD_DEADLINE_BREACHED>((resolve) => {
    pollId = setInterval(() => {
      if (now() > hardDeadlineMS) {
        resolve(HARD_DEADLINE_BREACHED);
      }
    }, pollIntervalMS);
  });

  try {
    const outcome = await Promise.race([work, breached]);
    if (outcome === HARD_DEADLINE_BREACHED) {
      // The abandoned work keeps running; never let its failure escape as an
      // unhandled rejection once nobody is awaiting it.
      work.catch(() => {});
      onBreach();
    }
    return outcome;
  } finally {
    if (pollId !== undefined) {
      clearInterval(pollId);
    }
  }
}
