/**
 * Tests for Issue #2901: DiscoveryReplayQueue deadline awareness.
 *
 * The queue must bound both waiting and replaying to an absolute hard cap:
 * - `waitForCompletion(pastDeadline)` drops the queued replay and signals the
 *   in-flight replay to abort, returning without awaiting further work.
 * - `scheduleReplay` skips scheduling once already past the cap.
 * - `#startReplay` passes an absolute deadline to the runner.
 * - Uncapped behaviour (no/zero deadline) is unchanged, preserving #1509.
 *
 * Behavioural "what" tests with injected timestamps — no elapsed-time
 * measurement (policy from #2888). Past = epoch ms `1`; future =
 * `Number.MAX_SAFE_INTEGER`.
 */
import { assertEquals } from "@std/assert";
import type { Creature } from "@creature";
import {
  type DiscoveryReplayControl,
  DiscoveryReplayQueue,
  type DiscoveryReplayQueueDeps,
} from "@neat/DiscoveryReplayQueue.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { DiscoveryReplayDirResult } from "@discovery/DiscoveryReplayRunner.ts";
import { makeForwardOnlyCreature as makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

const EMPTY_RESULT: DiscoveryReplayDirResult = {
  original: { error: 0, score: 0 },
  evaluatedSingles: 0,
  evaluatedCombos: 0,
  pruned: 0,
  skippedAlreadyApplied: 0,
  skippedNotApplicable: 0,
};

Deno.test("DiscoveryReplayQueue - waitForCompletion past the hard cap drops the queued replay and aborts the in-flight one", async () => {
  const creature1 = makeBaseCreature();
  creature1.uuid = "fittest-1";
  const creature2 = makeBaseCreature();
  creature2.uuid = "fittest-2";

  const startedUuids: string[] = [];
  let inFlightSignal: AbortSignal | undefined;

  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
      _timeoutMinutes?: number,
      control?: DiscoveryReplayControl,
    ): Promise<DiscoveryReplayDirResult> => {
      startedUuids.push(creature.uuid ?? "unknown");
      inFlightSignal = control?.signal;
      // Resolve only when aborted — models a long replay that stops
      // cooperatively at its next candidate boundary.
      return new Promise((resolve) => {
        const finish = () => resolve({ ...EMPTY_RESULT, timedOut: true });
        if (control?.signal?.aborted) finish();
        else control?.signal?.addEventListener("abort", finish);
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);
  const opts = { discoveryCacheDir: "/tmp/cache", costOfGrowth: 0 };

  queue.scheduleReplay(creature1, "/tmp/data", opts); // starts immediately
  queue.scheduleReplay(creature2, "/tmp/data", opts); // queued behind it

  // Past the hard cap: epoch ms 1 is always in the past.
  await queue.waitForCompletion(1);

  assertEquals(
    startedUuids,
    ["fittest-1"],
    "Queued replay must not start once past the hard cap",
  );
  assertEquals(
    inFlightSignal?.aborted,
    true,
    "In-flight replay must be signalled to abort at the hard cap",
  );

  // Drain: the in-flight promise resolves on abort, so an uncapped wait settles.
  await queue.waitForCompletion(Number.MAX_SAFE_INTEGER);
  assertEquals(
    queue.isReplayInProgress(),
    false,
    "No replay should be in progress after the abandoned replay settles",
  );
});

Deno.test("DiscoveryReplayQueue - scheduleReplay skips scheduling once past the hard cap", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  const startedUuids: string[] = [];
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (c: Creature): Promise<DiscoveryReplayDirResult> => {
      startedUuids.push(c.uuid ?? "unknown");
      return Promise.resolve(EMPTY_RESULT);
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // hardDeadlineTS = 1 (epoch ms) is always in the past.
  queue.scheduleReplay(
    creature,
    "/tmp/data",
    { discoveryCacheDir: "/tmp/cache", costOfGrowth: 0 },
    undefined,
    undefined,
    1,
  );

  await queue.waitForCompletion();

  assertEquals(startedUuids, [], "No replay should start past the hard cap");
  assertEquals(queue.isReplayInProgress(), false);
});

Deno.test("DiscoveryReplayQueue - startReplay passes the absolute hard cap to the runner", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let capturedDeadline: number | undefined = -1;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _c: Creature,
      _dataDir: string,
      _options: NeatOptions,
      _timeoutMinutes?: number,
      control?: DiscoveryReplayControl,
    ): Promise<DiscoveryReplayDirResult> => {
      capturedDeadline = control?.deadlineTS;
      return Promise.resolve(EMPTY_RESULT);
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // No relative timeout configured (discoveryReplayTimeoutMinutes: 0), so the
  // absolute deadline passed to the runner is exactly the hard cap.
  const hardCap = Number.MAX_SAFE_INTEGER;
  queue.scheduleReplay(
    creature,
    "/tmp/data",
    {
      discoveryCacheDir: "/tmp/cache",
      costOfGrowth: 0,
      discoveryReplayTimeoutMinutes: 0,
    },
    undefined,
    undefined,
    hardCap,
  );

  await queue.waitForCompletion();

  assertEquals(
    capturedDeadline,
    hardCap,
    "Runner should receive the absolute hard cap as its deadline",
  );
});

Deno.test("DiscoveryReplayQueue - waitForCompletion with a zero cap waits unbounded (preserves #1509)", async () => {
  const creature1 = makeBaseCreature();
  creature1.uuid = "fittest-1";
  const creature2 = makeBaseCreature();
  creature2.uuid = "fittest-2";

  const completed: string[] = [];
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: async (c: Creature): Promise<DiscoveryReplayDirResult> => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      completed.push(c.uuid ?? "unknown");
      return EMPTY_RESULT;
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);
  const opts = { discoveryCacheDir: "/tmp/cache", costOfGrowth: 0 };

  queue.scheduleReplay(creature1, "/tmp/data", opts);
  queue.scheduleReplay(creature2, "/tmp/data", opts);

  // A zero cap means "no cap" — both replays must complete (Issue #1509).
  await queue.waitForCompletion(0);

  assertEquals(
    completed.length,
    2,
    "Zero cap must wait for both in-flight and queued replays",
  );
  assertEquals(queue.isReplayInProgress(), false);
});
