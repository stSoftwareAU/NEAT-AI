/**
 * Barrier between a discovery's temp-dir cleanup and anything that writes back
 * into that run directory (GRQ #4609).
 *
 * `DataRecorder.runCleanup` may leave `DiscoverStructure.cleanUp()` — which
 * removes `.discovery/<uuid>/` recursively — running in the background so the
 * analysis result can be returned immediately. `WorkerProcessor` then writes
 * `worker-result-checkpoint.json` into that same directory. The two raced, and
 * the writer lost: the worker's `Deno.mkdir` yields, the pending removal takes
 * the directory away, and the following `Deno.writeTextFile` fails with
 * `NotFound … writefile '.discovery/<uuid>/worker-result-checkpoint.json'` —
 * one line after `Discovery <uuid> cleanup complete.` A completed evaluation
 * was discarded every time it happened.
 *
 * A cleanup registers here while it is in flight; a writer awaits the same
 * discovery ID before it touches the directory. Waiting on a removal that has
 * already settled is free, so the barrier costs nothing on the awaited-cleanup
 * path.
 *
 * The barrier orders a writer against the cleanup **it can see**. It is not a
 * lock: it does not stop an unrelated process removing the directory, which
 * still surfaces as a loud write failure at the call site.
 */

import { getLogger } from "@utils/Logger.ts";

/**
 * How long a writer waits for an in-flight cleanup before giving up on it.
 *
 * The wait must be bounded: a `cleanUp()` that never settles would otherwise
 * wedge the worker on a directory removal, which is a worse failure than the
 * one this module exists to remove. Expiry is announced and the writer
 * proceeds — whatever it then finds on disk it reports itself.
 */
export const DISCOVERY_CLEANUP_WAIT_MS = 60_000;

/**
 * In-flight cleanups, keyed by discovery ID (the full creature UUID, which is
 * also the run directory name). The stored promise never rejects — a failed
 * cleanup is reported by its owner, and a writer only needs to know the
 * removal has finished.
 */
const inFlightCleanups = new Map<string, Promise<void>>();

/**
 * Register an in-flight discovery cleanup so later writers to
 * `.discovery/<discoveryId>/` can order themselves after it.
 *
 * The caller keeps ownership of reporting a failed cleanup — `runCleanup` logs
 * `❌ CRITICAL … cleanup failed` on both of its branches. The rejection is
 * absorbed here only so the barrier does not report the same fault a second
 * time, and never so that it goes unreported.
 *
 * @param discoveryId - Discovery ID — the run directory name.
 * @param cleanup - The cleanup promise; the barrier tracks only its completion.
 */
export function trackDiscoveryCleanup(
  discoveryId: string,
  cleanup: Promise<unknown>,
): void {
  const settled = cleanup.then(() => {}, () => {});
  inFlightCleanups.set(discoveryId, settled);
  settled.then(() => {
    // Only clear our own registration: a later cleanup for the same ID must
    // keep its entry.
    if (inFlightCleanups.get(discoveryId) === settled) {
      inFlightCleanups.delete(discoveryId);
    }
  });
}

/**
 * Wait until the tracked cleanup for `discoveryId` has finished.
 *
 * Resolves immediately when no cleanup is tracked (nothing is removing the
 * directory) and never rejects — a cleanup that failed has still finished, and
 * the caller's own write reports whatever state it finds.
 *
 * @param discoveryId - Discovery ID — the run directory name.
 * @param timeoutMs - Bound on the wait; defaults to
 *   {@link DISCOVERY_CLEANUP_WAIT_MS}.
 */
export async function awaitDiscoveryCleanup(
  discoveryId: string,
  timeoutMs: number = DISCOVERY_CLEANUP_WAIT_MS,
): Promise<void> {
  const pending = inFlightCleanups.get(discoveryId);
  if (pending === undefined) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      pending.then(() => "cleaned" as const),
      new Promise<"timed-out">((resolve) => {
        timer = setTimeout(() => resolve("timed-out"), timeoutMs);
      }),
    ]);
    if (outcome === "timed-out") {
      getLogger().warn(
        `⚠️ Discovery ${discoveryId} cleanup still running after ${timeoutMs}ms; ` +
          `writing to its run directory without waiting any longer.`,
      );
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
