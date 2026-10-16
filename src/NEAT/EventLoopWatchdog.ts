/**
 * Event-loop watchdog primitive — Issue #4066, part of #4060.
 *
 * Every in-process training bound (`awaitWithinHardDeadline` in
 * `HardDeadlineRace.ts` is the reference) polls its deadline with `setInterval`
 * on the same event loop as the work it bounds. That poll only fires while the
 * loop is free. A main thread blocked in a synchronous loop, or a V8 heap that
 * is thrashing in garbage collection, silences the bound at exactly the moment
 * it is needed — the #4060 failure mode.
 *
 * `armEventLoopWatchdog` therefore runs its deadline in a Deno Worker, which has
 * its own event loop and its own timer. At the deadline the Worker writes the
 * breach line to stderr and sends `SIGKILL` to the whole process, so a wedged
 * run ends with exit status 137 instead of outliving its own cap.
 *
 * Why `SIGKILL` and not the usual alternatives:
 *
 * - `SIGTERM` is swallowed when the main thread has a `SIGTERM` listener, and
 *   `evolveDir`, `evolveEnv` and `evolveRL` register one in
 *   `src/creature/CreatureTraining.ts`.
 * - `Deno.exit` called from a Worker ends only that Worker, not the process.
 *
 * `SIGKILL` skips in-process cleanup. That is acceptable for a last-resort
 * bound: by the time it fires, the cooperative bounds have already failed, and
 * the run's completed work is what has been persisted so far.
 *
 * The caller must `disarm()` in a `finally`. An armed Worker keeps the process
 * alive until its deadline, so a run that finishes early must release it.
 *
 * Nothing arms this primitive yet. Issue #4067 will wire it into `evolveDir`,
 * `evolveEnv` and `evolveRL`.
 *
 * @module
 */

import { getLogger } from "../utils/Logger.ts";
import { ConfigurationError } from "../errors/ConfigurationError.ts";

/**
 * Placeholder in `breachLine` that is replaced at breach time with the last
 * generation passed to {@link EventLoopWatchdog.setGeneration}, or `unknown` if
 * no generation has been set.
 */
export const EVENT_LOOP_WATCHDOG_GENERATION_TOKEN = "{generation}";

/** Options for {@link armEventLoopWatchdog}. */
export interface EventLoopWatchdogOptions {
  /**
   * Absolute deadline as epoch milliseconds on the real wall clock, i.e. the
   * same clock as `Date.now()`. Must be finite.
   */
  deadlineEpochMS: number;
  /**
   * Line written to stderr at breach, before the process is killed. Every
   * occurrence of {@link EVENT_LOOP_WATCHDOG_GENERATION_TOKEN} is replaced with
   * the current generation. Must be non-empty after trimming.
   */
  breachLine: string;
}

/** Handle returned by {@link armEventLoopWatchdog}. */
export interface EventLoopWatchdog {
  /**
   * Stop the watchdog so the process can exit without a breach. Idempotent,
   * because `Worker.terminate()` is. Call it in a `finally` once the bounded
   * work is over.
   */
  disarm(): void;
  /**
   * Record the generation the run is currently on, for the breach line. Must be
   * a safe non-negative integer no greater than 2147483647.
   */
  setGeneration(generation: number): void;
}

/** Stored in the shared generation slot until {@link setGeneration} is called. */
const GENERATION_UNKNOWN = -1;

/** Largest generation the shared `Int32Array` slot can hold. */
const GENERATION_MAX = 2147483647;

/** Handle used when the Worker cannot be armed: every call does nothing. */
const NOOP_HANDLE: EventLoopWatchdog = {
  disarm(): void {},
  setGeneration(): void {},
};

function logUnavailable(cause: string): void {
  getLogger().error(
    `[Neat] event-loop watchdog unavailable: ${cause} — only the in-process bound applies`,
  );
}

/**
 * Arm an off-main-thread deadline that SIGKILLs the process at breach.
 *
 * The options are validated before anything is spawned. If the Worker cannot
 * be created, the failure is logged once and a no-op handle is returned, so the
 * in-process bound still applies. A Worker that fails to load (for example
 * without read permission) reports asynchronously; that path is handled by the
 * `error` listener below.
 *
 * @throws {ConfigurationError} `NOT_FINITE` if `deadlineEpochMS` is not finite;
 *   `INVALID_TYPE` if `breachLine` is empty after trimming.
 */
export function armEventLoopWatchdog(
  options: EventLoopWatchdogOptions,
): EventLoopWatchdog {
  if (!Number.isFinite(options.deadlineEpochMS)) {
    throw new ConfigurationError(
      `deadlineEpochMS must be a finite epoch-ms number, got ${options.deadlineEpochMS}`,
      "NOT_FINITE",
    );
  }
  if (
    typeof options.breachLine !== "string" ||
    options.breachLine.trim().length === 0
  ) {
    throw new ConfigurationError(
      "breachLine must be a non-empty string",
      "INVALID_TYPE",
    );
  }

  // The generation lives in shared memory rather than in a message. The Worker
  // reads it at breach time, so it sees the latest value even when the main
  // thread blocks straight after writing it, with no dependence on the order in
  // which messages are delivered.
  const generationBuffer = new SharedArrayBuffer(4);
  const generation = new Int32Array(generationBuffer);
  Atomics.store(generation, 0, GENERATION_UNKNOWN);

  // SIMPLE-ON-PURPOSE: fixed deadline, no heartbeat — upgrade when a run needs liveness detection before the last-resort deadline
  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./EventLoopWatchdogWorker.ts", import.meta.url),
      { type: "module", name: "neat-event-loop-watchdog" },
    );
  } catch (err) {
    logUnavailable(err instanceof Error ? err.message : String(err));
    return NOOP_HANDLE;
  }

  // A Worker that cannot load does not throw from `new Worker`. It reports an
  // asynchronous `error` event instead. Preventing the default stops that event
  // from crashing the main process.
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    worker.terminate();
    logUnavailable(event.message);
  });

  worker.postMessage({
    deadlineEpochMS: options.deadlineEpochMS,
    breachLine: options.breachLine,
    generationBuffer,
  });

  return {
    // Idempotent because `Worker.terminate()` is idempotent.
    disarm(): void {
      worker.terminate();
    },
    setGeneration(next: number): void {
      if (!Number.isInteger(next)) {
        throw new ConfigurationError(
          `generation must be an integer, got ${next}`,
          "NOT_INTEGER",
        );
      }
      if (next < 0 || next > GENERATION_MAX) {
        throw new ConfigurationError(
          `generation must be between 0 and ${GENERATION_MAX}, got ${next}`,
          "OUT_OF_RANGE",
        );
      }
      Atomics.store(generation, 0, next);
    },
  };
}
