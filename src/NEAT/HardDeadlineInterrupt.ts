/**
 * Hard-deadline interrupt enforcement (GRQ #4418).
 *
 * {@link module:HardDeadline} computes *when* a run must stop and the watchdog
 * in `Neat.abandonInFlightPastHardDeadline` aborts the named in-flight phase
 * when that moment passes. Aborting, however, only asks: on GRQ-26 a `team`
 * unit sat inside `Fitness.calculate` awaiting a `rust_scorer` batch call that
 * never returned, so the watchdog logged
 * `stalled in fitness; interrupting` once a second for 2h 42m while the unit
 * kept running — 16× the timeout it was given.
 *
 * This module turns the request into a bound: work that has not settled within
 * {@link HARD_DEADLINE_INTERRUPT_GRACE_MS} of the abort fails loud with a
 * {@link HardDeadlineExceededError}. A unit told to run X minutes then dies
 * inside ~2× X whether or not the code it is stuck in cooperates.
 *
 * The grace is injectable so tests need no real waits (policy #2888).
 *
 * @module HardDeadlineInterrupt
 */

/**
 * How long a phase has to unwind after its abort signal fires before the run
 * is failed outright.
 *
 * Long enough for a cooperative phase to finish scoring what it has and
 * return; far too short to matter against the `timeoutMinutes + grace` cap it
 * follows.
 */
export const HARD_DEADLINE_INTERRUPT_GRACE_MS = 30_000;

/**
 * Raised when an interrupted phase did not return within its grace.
 *
 * Carries the phase name so the operator sees *where* the unit wedged, not
 * merely that it was killed.
 */
export class HardDeadlineExceededError extends Error {
  override readonly name = "HardDeadlineExceededError";
  /** The in-flight phase that ignored the interrupt (e.g. `fitness`). */
  readonly phase: string;
  /** The grace, in milliseconds, that elapsed before failing the run. */
  readonly graceMS: number;

  constructor(phase: string, graceMS: number) {
    super(
      `Hard deadline exceeded — ${phase} did not return ${graceMS}ms after ` +
        `the interrupt; failing the unit rather than outliving its timeout`,
    );
    this.phase = phase;
    this.graceMS = graceMS;
  }
}

/**
 * Bound `work` by the hard-deadline interrupt.
 *
 * Resolves/rejects exactly as `work` does until `signal` aborts. From the
 * abort, `work` has `graceMS` to settle; past that the returned promise
 * rejects with a {@link HardDeadlineExceededError} and the caller fails the
 * unit. `work` itself is left to whatever it is doing — a wedged read cannot
 * be cancelled from here — but it can no longer hold the run open.
 *
 * @param work    The in-flight phase.
 * @param signal  The phase's abort signal, or `undefined` for an uncapped run.
 * @param phase   Name of the phase, for the failure message.
 * @param graceMS Grace after the abort. Defaults to
 *                {@link HARD_DEADLINE_INTERRUPT_GRACE_MS}.
 */
export function failLoudIfInterruptIgnored<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  phase: string,
  graceMS: number = HARD_DEADLINE_INTERRUPT_GRACE_MS,
): Promise<T> {
  if (!signal) return work;

  // The race below drops `work` the moment the grace expires. Claim its
  // rejection here so a later failure cannot surface as an unhandled one.
  work.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  let armTimer: (() => void) | undefined;

  const enforcement = new Promise<never>((_, reject) => {
    armTimer = () => {
      timer = setTimeout(
        () => reject(new HardDeadlineExceededError(phase, graceMS)),
        Math.max(0, graceMS),
      );
    };
    if (signal.aborted) {
      armTimer();
      return;
    }
    signal.addEventListener("abort", armTimer, { once: true });
  });

  return Promise.race([work, enforcement]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (armTimer) signal.removeEventListener("abort", armTimer);
  });
}
