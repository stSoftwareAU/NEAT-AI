/**
 * `DataRecorder.runCleanup` must publish its cleanup to the barrier, including
 * on the async branch that returns the analysis while `.discovery/<ID>/` is
 * still being removed (GRQ #4609).
 *
 * Without this wiring the worker's checkpoint write has nothing to wait for and
 * races the removal — the `NotFound … writefile
 * '.discovery/<uuid>/worker-result-checkpoint.json'` in the source logs.
 *
 * The private `runCleanup` is driven directly, as
 * `DiscoveryCleanupReporting.ts` already does, and the assertion is on the
 * observable outcome: what a writer to that directory saw when it was released.
 */

import { assertEquals } from "@std/assert";
import { DataRecorder } from "@architecture/ErrorGuidedStructuralEvolution/DataRecorder.ts";
import { DiscoveryPerformanceStats } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryPerformance.ts";
import type { DiscoverStructure } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { awaitDiscoveryCleanup } from "@discovery/DiscoveryCleanupBarrier.ts";

type RunCleanup = (
  discoverStructure: DiscoverStructure,
  perfStats: DiscoveryPerformanceStats,
  startTime: number,
) => Promise<void>;

/** Invokes the private `runCleanup` with the minimal state it reads. */
async function runCleanup(
  id: string,
  cleanUp: () => Promise<void>,
  awaitCleanup: boolean,
): Promise<void> {
  const proto = DataRecorder.prototype as unknown as { runCleanup: RunCleanup };
  const self = {
    ID: id,
    config: { verbose: false, log: 0 },
    shouldAwaitCleanup: () => awaitCleanup,
  };
  await proto.runCleanup.call(
    self as unknown as DataRecorder,
    { cleanUp } as unknown as DiscoverStructure,
    new DiscoveryPerformanceStats(),
    0,
  );
}

Deno.test("runCleanup publishes an async cleanup so a later writer waits for it (GRQ #4609)", async () => {
  const id = "4a1c9f30-1111-2222-3333-444455556666";
  let removalFinished = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  // The async branch: runCleanup returns while the removal is still running.
  await runCleanup(
    id,
    () =>
      gate.then(() => {
        removalFinished = true;
      }),
    false,
  );
  assertEquals(
    removalFinished,
    false,
    "precondition: the removal is still in flight after runCleanup returned",
  );

  let sawRemovalFinished: boolean | undefined;
  const writer = awaitDiscoveryCleanup(id).then(() => {
    sawRemovalFinished = removalFinished;
  });

  release();
  await writer;

  assertEquals(
    sawRemovalFinished,
    true,
    "a writer to .discovery/<ID>/ ran while the removal was still in flight",
  );
});

Deno.test("runCleanup publishes an awaited cleanup too, which the barrier passes straight through", async () => {
  const id = "4a1c9f30-aaaa-bbbb-cccc-ddddeeeeffff";
  await runCleanup(id, () => Promise.resolve(), true);
  // Already settled: waiting costs nothing on the awaited path.
  await awaitDiscoveryCleanup(id);
});
