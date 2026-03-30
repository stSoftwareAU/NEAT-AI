/**
 * Tests for Issue #1509: evolveDir should await
 * DiscoveryReplayQueue.waitForCompletion() before returning.
 *
 * When evolveDir() returns, the DiscoveryReplayQueue may still have background
 * replay tasks running that read from the data directory. If the caller deletes
 * that directory, the background workers fail. The fix ensures evolveDir()
 * awaits waitForCompletion() before returning.
 */
import { assertEquals } from "@std/assert";
import type { Creature } from "@creature";
import {
  DiscoveryReplayQueue,
  type DiscoveryReplayQueueDeps,
} from "@neat/DiscoveryReplayQueue.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type { DiscoveryReplayDirResult } from "@discovery/DiscoveryReplayRunner.ts";
import { makeForwardOnlyCreature as makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

/**
 * Test: waitForCompletion() resolves only after all queued replays finish.
 *
 * This verifies the core behaviour needed by Issue #1509: after calling
 * waitForCompletion(), no replay tasks should still be running. This is
 * what evolveDir() must call before returning to prevent the caller from
 * deleting the data directory while replays are still in progress.
 */
Deno.test("DiscoveryReplayQueue - waitForCompletion resolves after all replays finish", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let replayCompleted = false;

  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: async (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ): Promise<DiscoveryReplayDirResult> => {
      // Simulate async work that takes some time
      await new Promise((resolve) => setTimeout(resolve, 50));
      replayCompleted = true;
      return {
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      };
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
  });

  // Before waiting, replay may still be running
  assertEquals(
    queue.isReplayInProgress(),
    true,
    "Replay should be in progress",
  );

  // After waitForCompletion, replay must be done
  await queue.waitForCompletion();

  assertEquals(replayCompleted, true, "Replay should have completed");
  assertEquals(
    queue.isReplayInProgress(),
    false,
    "No replay should be in progress after waitForCompletion",
  );
});

/**
 * Test: waitForCompletion() waits for queued replay too, not just the current one.
 *
 * When evolveDir() calls waitForCompletion(), there may be both a current
 * replay in progress AND a queued replay. Both must complete before
 * waitForCompletion() resolves.
 */
Deno.test("DiscoveryReplayQueue - waitForCompletion waits for queued replays too", async () => {
  const creature1 = makeBaseCreature();
  creature1.uuid = "fittest-1";
  const creature2 = makeBaseCreature();
  creature2.uuid = "fittest-2";

  const completedReplays: string[] = [];

  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: async (
      creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ): Promise<DiscoveryReplayDirResult> => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      completedReplays.push(creature.uuid ?? "unknown");
      return {
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      };
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);
  const opts = { discoveryCacheDir: "/tmp/cache", costOfGrowth: 0 };

  // Schedule first replay (starts immediately)
  queue.scheduleReplay(creature1, "/tmp/data", opts);
  // Schedule second replay (queued because first is in progress)
  queue.scheduleReplay(creature2, "/tmp/data", opts);

  // After waitForCompletion, both must have finished
  await queue.waitForCompletion();

  assertEquals(
    completedReplays.length,
    2,
    "Both replays should have completed before waitForCompletion resolves",
  );
  assertEquals(
    queue.isReplayInProgress(),
    false,
    "No replay should be in progress after waitForCompletion",
  );
});

/**
 * Test: waitForCompletion() is safe to call when no replays are pending.
 *
 * This ensures evolveDir() can safely call waitForCompletion() even when
 * no discovery replay was ever scheduled (e.g. discoveryCacheDir not set).
 */
Deno.test("DiscoveryReplayQueue - waitForCompletion is safe when no replays pending", async () => {
  const queue = new DiscoveryReplayQueue();

  // Should resolve immediately without error
  await queue.waitForCompletion();

  assertEquals(
    queue.isReplayInProgress(),
    false,
    "No replay should be in progress",
  );
});
