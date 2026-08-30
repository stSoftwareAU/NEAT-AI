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
 * How many times the expected duration (`timeoutMinutes`) a run may last
 * before NEAT-AI stops starting new generations and finishes with the evolved
 * population (GRQ #4141).
 *
 * A factor of `1` means "elapsed > expected" — the 15-minute expected-duration
 * default itself is unchanged; only the breach action changes from warn-only
 * to self-termination. The 3-hour GRQ wall-clock cap is not this lever.
 */
export const DEFAULT_OVERRUN_ENFORCEMENT_FACTOR = 1;

/**
 * How often the in-generation hard-deadline watchdog polls while a phase
 * (especially fitness) is in flight. Injectable `now` keeps tests free of
 * real waits (#2888).
 */
export const HARD_DEADLINE_WATCHDOG_INTERVAL_MS = 1_000;

/**
 * Why an `evolve*` run stopped. Distinguishes graceful over-run
 * self-termination from the T+15 hard-deadline abandon path.
 */
export type EvolveTerminationReason =
  | "overrun"
  | "hard-deadline"
  | "iterations"
  | "target-error"
  | "interrupted";

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

/**
 * True when elapsed wall-clock has exceeded the expected duration
 * (`timeoutMinutes`) by {@link factor} (GRQ #4141).
 *
 * Unset / zero `timeoutMinutes` never over-runs — there is no expected
 * duration to breach. Non-positive or non-finite factors fall back to
 * {@link DEFAULT_OVERRUN_ENFORCEMENT_FACTOR}.
 *
 * Pure: timestamps in, boolean out — no real clock (#2888).
 */
export function hasTrainingOverrun(
  startMS: number,
  timeoutMinutes: number,
  nowMS: number,
  factor: number = DEFAULT_OVERRUN_ENFORCEMENT_FACTOR,
): boolean {
  if (
    !timeoutMinutes || !Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0
  ) {
    return false;
  }
  const effectiveFactor = Number.isFinite(factor) && factor > 0
    ? factor
    : DEFAULT_OVERRUN_ENFORCEMENT_FACTOR;
  const expectedMS = Math.max(1, timeoutMinutes) * 60_000;
  return nowMS - startMS > expectedMS * effectiveFactor;
}

/**
 * True when the evolve loop must not start another generation: at least one
 * generation has completed and {@link hasTrainingOverrun} is true.
 *
 * The first generation is always allowed to start so a run that begins
 * already past its expected duration still produces a committed population
 * (existing T+15 hard-cap tests rely on generation 1 completing).
 */
export function shouldStopStartingGenerations(
  generationsCompleted: number,
  startMS: number,
  timeoutMinutes: number,
  nowMS: number,
  factor: number = DEFAULT_OVERRUN_ENFORCEMENT_FACTOR,
): boolean {
  return generationsCompleted > 0 &&
    hasTrainingOverrun(startMS, timeoutMinutes, nowMS, factor);
}

/**
 * True when in-flight work must be abandoned at the hard cap: at least one
 * generation has completed **and** the cap has passed (Issue #3940).
 *
 * The generation floor is the same one {@link shouldStopStartingGenerations}
 * applies. It used to be the soft guard's alone, so a first generation slower
 * than `timeoutMinutes + grace` was abandoned mid-flight and the run returned
 * zero generations — an unscored population with no winner to publish. Once one
 * generation is in hand the cap behaves exactly as it did before (#2892/#2896):
 * a run that is making progress is still bounded.
 *
 * Pure: counts and timestamps in, boolean out — no real clock (#2888).
 *
 * @param generationsCompleted Generations banked by this run so far.
 * @param hardDeadlineMS       Absolute cap (epoch ms); 0/unset = no cap.
 * @param nowMS                Current epoch ms.
 */
export function shouldAbandonInFlight(
  generationsCompleted: number,
  hardDeadlineMS: number,
  nowMS: number,
): boolean {
  return generationsCompleted > 0 && hardDeadlineMS > 0 &&
    nowMS > hardDeadlineMS;
}
