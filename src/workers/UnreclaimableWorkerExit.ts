/**
 * Opt-in exit for a process that is held open only by worker threads that
 * could not be stopped (Issue #4126).
 *
 * `Worker.terminate()` cannot interrupt a thread blocked in native (FFI) code,
 * and Deno keeps the event loop alive for that thread, so the process never
 * exits after its work is done. The exit is armed with a timer that is unref'd
 * (`Deno.unrefTimer`), so the timer on its own never keeps the process alive.
 * An unref'd timer still fires while the event loop is alive for another
 * reason: once only the blocked thread is left, the loop stays open and the
 * timer fires. If the loop drains first, the process exits naturally before
 * the timer can fire, so a healthy process is unaffected. `unload` and
 * `beforeunload` do not fire in this state, which is why a timer is used.
 *
 * Nothing is armed unless a caller asks for it.
 *
 * @module
 */

import { ValidationError } from "@errors/ValidationError.ts";
import { getLogger } from "@utils/Logger.ts";

/** How long an armed exit waits before it fires (Issue #4126). */
export const UNRECLAIMABLE_WORKER_EXIT_GRACE_MS = 10_000;

export interface UnreclaimableWorkerExitOptions {
  /** The operation that finished, named in the warning (e.g. `evolveDir`). */
  label: string;
  /** Workers that could not be stopped. Must be a positive integer. */
  count: number;
  /**
   * Wait before the process exits. Must be positive and finite. Defaults to
   * {@link UNRECLAIMABLE_WORKER_EXIT_GRACE_MS}.
   */
  graceMS?: number;
  /** Exits the process. Defaults to `Deno.exit`. */
  exit?: (code: number) => void;
  /**
   * Runs `fn` after `ms`. Defaults to `setTimeout`, with the timer unref'd so
   * it does not keep the process alive by itself.
   */
  schedule?: (fn: () => void, ms: number) => void;
}

function defaultSchedule(fn: () => void, ms: number): void {
  const handle = setTimeout(fn, ms);
  Deno.unrefTimer(handle);
}

/**
 * Arms an exit for the case where unstoppable worker threads are the only
 * thing left holding the process open (Issue #4126).
 *
 * When the timer fires, a warning names the label, the count and the grace,
 * then the process exits with the exit code it already carries
 * (`Deno.exitCode`).
 *
 * @throws {ValidationError} when `count` is not a positive integer, or when
 *   `graceMS` is not positive and finite. Nothing is scheduled in that case.
 */
export function armUnreclaimableWorkerExit(
  o: UnreclaimableWorkerExitOptions,
): void {
  if (!Number.isInteger(o.count) || o.count <= 0) {
    throw new ValidationError(
      `armUnreclaimableWorkerExit: count must be a positive integer, got ${o.count}`,
      "OTHER",
    );
  }
  const graceMS = o.graceMS ?? UNRECLAIMABLE_WORKER_EXIT_GRACE_MS;
  if (!Number.isFinite(graceMS) || graceMS <= 0) {
    throw new ValidationError(
      `armUnreclaimableWorkerExit: graceMS must be positive and finite, got ${graceMS}`,
      "OTHER",
    );
  }
  const exit = o.exit ?? ((code: number) => Deno.exit(code));
  const schedule = o.schedule ?? defaultSchedule;

  schedule(() => {
    const code = Deno.exitCode;
    getLogger().warn(
      `${o.label}: ${o.count} worker thread(s) could not be stopped; exiting ` +
        `the process after the ${graceMS} ms grace, because those threads ` +
        `would otherwise keep it alive. Exit code ${code} is preserved ` +
        `(Issue #4126).`,
    );
    exit(code);
  }, graceMS);
}
