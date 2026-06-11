/**
 * Hard-deadline (T+15) helper — Issue #2895, part of #2892.
 *
 * A single source of truth for the evolution hard cap: the absolute wall-clock
 * timestamp past which `evolveDir` must abandon all in-flight work. Discovery,
 * training and replay phases each anchor their own relative budgets at task
 * start with no shared absolute cap, so GRQ runs configured with a short
 * `--timeout` can still be killed by the external watchdog. This module
 * computes a shared cap that later sub-issues enforce in each phase.
 *
 * The helper is pure — absolute timestamps in, absolute timestamps out — so
 * tests need no real clock (policy from #2888).
 */

/** The maximum permitted overrun, in minutes, past the configured `timeoutMinutes`. */
export const HARD_DEADLINE_GRACE_MINUTES = 15;

/**
 * Compute the absolute hard-deadline timestamp.
 *
 * Returns `startMS + timeoutMinutes * 60_000 + graceMS`, where the grace period
 * is clamped to `min(HARD_DEADLINE_GRACE_MINUTES, max(1, timeoutMinutes))`
 * minutes. Clamping grace to `min(15, T)` keeps short runs proportionate (a
 * 2-minute run gets at most 2 minutes of grace) while never exceeding the
 * 15-minute cap for long runs.
 *
 * @param startMS         Absolute start timestamp in milliseconds.
 * @param timeoutMinutes  Configured soft timeout in minutes.
 * @returns The absolute hard-deadline timestamp in milliseconds, or `undefined`
 *          when `timeoutMinutes` is 0/unset (no timeout configured → no cap).
 */
export function computeHardDeadlineTS(
  startMS: number,
  timeoutMinutes: number,
): number | undefined {
  if (!timeoutMinutes) {
    return undefined;
  }

  const graceMinutes = Math.min(
    HARD_DEADLINE_GRACE_MINUTES,
    Math.max(1, timeoutMinutes),
  );

  return startMS + timeoutMinutes * 60_000 + graceMinutes * 60_000;
}
