/**
 * Run-level event-loop watchdog for `evolveDir`, `evolveEnv` and `evolveRL` —
 * Issue #4067, part of #4060.
 *
 * The in-process generation bounds poll on the same event loop as the work they
 * bound, so a main thread blocked in a synchronous loop silences them. This
 * controller arms the off-main-thread watchdog from `EventLoopWatchdog.ts` for
 * the run: first for generation 1's bound, then, once generation 1 completes,
 * for the hard cap. Each deadline is the real-clock remaining budget plus a
 * margin, so the Worker SIGKILLs the process only after the in-process bound
 * has had its chance to end the run.
 *
 * @module
 */

import {
  armEventLoopWatchdog,
  EVENT_LOOP_WATCHDOG_GENERATION_TOKEN,
  type EventLoopWatchdog,
  type EventLoopWatchdogOptions,
} from "@neat/EventLoopWatchdog.ts";
import {
  computeWatchdogDeadlineEpochMS,
  DEFAULT_WATCHDOG_MARGIN_MS,
} from "@neat/HardDeadline.ts";

/** Lifecycle handle for one evolve run's watchdog. */
export interface RunWatchdog {
  /**
   * Record that `generationsCompleted` generations have completed. The first
   * call re-arms the watchdog from the first-generation bound to the hard cap;
   * every call updates the breach line's generation.
   */
  generationCompleted(generationsCompleted: number): void;
  /** Idempotent. After it, generationCompleted never re-arms. */
  disarm(): void;
}

/** Inputs to {@link armRunWatchdog}. */
export interface ArmRunWatchdogParams {
  /** Configured soft timeout; falsy means no watchdog is armed. */
  timeoutMinutes: number | undefined;
  /** Injected run start (ms since epoch). */
  startMS: number;
  /** Generation 1's bound on the injected clock (ms since epoch). */
  firstGenerationDeadlineMS: number;
  /** Hard cap on the injected clock (ms since epoch). */
  hardDeadlineMS: number;
  /** Injected clock (`deps.now ?? Date.now`). */
  now: () => number;
  /** Arms the Worker; defaults to `armEventLoopWatchdog`. */
  armWatchdog?: (options: EventLoopWatchdogOptions) => EventLoopWatchdog;
  /**
   * Margin past each bound before the SIGKILL; defaults to
   * `DEFAULT_WATCHDOG_MARGIN_MS`.
   */
  marginMS?: number;
  /** Real wall clock the Worker compares against; defaults to `Date.now`. */
  realNow?: () => number;
}

const NO_OP_RUN_WATCHDOG: RunWatchdog = {
  generationCompleted(): void {},
  disarm(): void {},
};

/**
 * Arm the run's event-loop watchdog for generation 1. Returns a no-op handle
 * when `timeoutMinutes` is falsy, in which case `armWatchdog` is never called.
 */
export function armRunWatchdog(params: ArmRunWatchdogParams): RunWatchdog {
  if (!params.timeoutMinutes) return NO_OP_RUN_WATCHDOG;

  const arm = params.armWatchdog ?? armEventLoopWatchdog;
  const marginMS = params.marginMS ?? DEFAULT_WATCHDOG_MARGIN_MS;
  const realNow = params.realNow ?? Date.now;
  const { startMS, now } = params;

  let onFirstGeneration = true;
  let disarmed = false;

  const armBound = (
    boundMS: number,
    breachLine: (seconds: number) => string,
  ): EventLoopWatchdog => {
    const injected = now();
    const deadlineEpochMS = computeWatchdogDeadlineEpochMS(
      realNow(),
      boundMS,
      injected,
      marginMS,
    );
    const seconds = Math.round(
      (Math.max(boundMS, injected) + marginMS - startMS) / 1000,
    );
    return arm({ deadlineEpochMS, breachLine: breachLine(seconds) });
  };

  let current: EventLoopWatchdog | undefined = armBound(
    params.firstGenerationDeadlineMS,
    (seconds) =>
      `[Neat] First generation wedged after ${seconds}s (event loop blocked ` +
      `past the first-generation bound; watchdog killing the process) — ` +
      `first-generation-wedged`,
  );
  current.setGeneration(0);

  return {
    generationCompleted(generationsCompleted: number): void {
      if (disarmed) return;
      if (onFirstGeneration) {
        onFirstGeneration = false;
        current?.disarm();
        current = armBound(
          params.hardDeadlineMS,
          (seconds) =>
            `[Neat] Run wedged after ${seconds}s at generation ` +
            `${EVENT_LOOP_WATCHDOG_GENERATION_TOKEN} (event loop blocked past ` +
            `the hard cap; watchdog killing the process)`,
        );
      }
      current?.setGeneration(generationsCompleted);
    },
    disarm(): void {
      disarmed = true;
      current?.disarm();
      current = undefined;
    },
  };
}
