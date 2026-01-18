import { assertEquals, assertExists } from "@std/assert";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";
import type { DiscoveryReplayDirResult } from "../../src/discovery/DiscoveryReplayRunner.ts";
import { Creature } from "../../src/Creature.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import {
  DiscoveryReplayQueue,
  type DiscoveryReplayQueueDeps,
} from "../../src/NEAT/DiscoveryReplayQueue.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";

/**
 * Tests for DiscoveryReplayQueue (Issue #997).
 *
 * The DiscoveryReplayQueue handles non-blocking background replay of
 * cached discoveries against the current fittest creature.
 */

function makeBaseCreature(): Creature {
  const base: CreatureExport = {
    input: 1,
    output: 1,
    forwardOnly: true,
    neurons: [
      { uuid: "hidden-0", type: "hidden", squash: IDENTITY.NAME, bias: 0.1 },
      { uuid: "output-0", type: "output", squash: IDENTITY.NAME, bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.25 },
    ],
  };
  return Creature.fromJSON(base);
}

Deno.test("DiscoveryReplayQueue - schedules replay when new fittest is detected", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let replayStarted = false;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ) => {
      replayStarted = true;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // Schedule replay for the fittest creature
  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
  });

  // Wait for the async operation to complete
  await queue.waitForCompletion();

  assertEquals(replayStarted, true, "Replay should have been started");
});

Deno.test("DiscoveryReplayQueue - only one replay at a time", async () => {
  const creature1 = makeBaseCreature();
  creature1.uuid = "fittest-1";

  const creature2 = makeBaseCreature();
  creature2.uuid = "fittest-2";

  let activeReplays = 0;
  let maxActiveReplays = 0;
  let totalReplays = 0;

  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: async (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ) => {
      activeReplays++;
      totalReplays++;
      maxActiveReplays = Math.max(maxActiveReplays, activeReplays);

      // Simulate some processing time
      await new Promise((resolve) => setTimeout(resolve, 50));

      activeReplays--;
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

  // Schedule multiple replays rapidly
  queue.scheduleReplay(creature1, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
  });
  queue.scheduleReplay(creature2, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
  });

  // Wait for all operations to complete
  await queue.waitForCompletion();

  assertEquals(maxActiveReplays, 1, "Only one replay should run at a time");
  // The second creature should be queued, so eventually both should run
  assertEquals(totalReplays >= 1, true, "At least one replay should have run");
});

Deno.test("DiscoveryReplayQueue - returns improved creature", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  const improvedCreature = makeBaseCreature();
  improvedCreature.uuid = "improved-1";

  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ) => {
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        improvement: {
          key: "test-key",
          changeType: "add-synapses",
          error: 0.4,
          score: 0.6,
          scoreDelta: 0.1,
          message: "Improved!",
          creature: improvedCreature.exportJSON(),
        },
        evaluatedSingles: 1,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
  });

  await queue.waitForCompletion();

  const results = queue.getCompletedResults();
  assertEquals(results.length, 1, "Should have one completed result");
  assertExists(results[0].improvement, "Result should have improvement");
  assertEquals(results[0].improvement?.score, 0.6);
});

Deno.test("DiscoveryReplayQueue - skips replay if no cache directory", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let replayAttempted = false;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ) => {
      replayAttempted = true;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // No discoveryCacheDir provided
  queue.scheduleReplay(creature, "/tmp/data", {
    costOfGrowth: 0,
  });

  await queue.waitForCompletion();

  assertEquals(
    replayAttempted,
    false,
    "Replay should not be attempted without cache directory",
  );
});

Deno.test("DiscoveryReplayQueue - queues newest fittest when replay in progress", async () => {
  const creature1 = makeBaseCreature();
  creature1.uuid = "fittest-1";

  const creature2 = makeBaseCreature();
  creature2.uuid = "fittest-2";

  const creature3 = makeBaseCreature();
  creature3.uuid = "fittest-3";

  const replayedCreatures: string[] = [];
  // deno-lint-ignore no-explicit-any
  let firstReplayResolve: any = null;

  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: async (
      creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ) => {
      replayedCreatures.push(creature.uuid ?? "unknown");

      // First replay waits for signal to complete
      if (creature.uuid === "fittest-1") {
        await new Promise<void>((resolve) => {
          firstReplayResolve = resolve;
        });
      }

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

  // Start first replay
  queue.scheduleReplay(creature1, "/tmp/data", opts);

  // Wait a tick for replay to start
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Queue more creatures while replay is in progress
  queue.scheduleReplay(creature2, "/tmp/data", opts);
  queue.scheduleReplay(creature3, "/tmp/data", opts);

  // Complete the first replay
  if (firstReplayResolve) {
    firstReplayResolve();
  }

  await queue.waitForCompletion();

  // Should replay the first creature, and then the last queued creature
  // (creature2 should be replaced by creature3 in the queue)
  assertEquals(replayedCreatures[0], "fittest-1");
  // The second replay should be the newest queued creature
  assertEquals(
    replayedCreatures.includes("fittest-3"),
    true,
    "Should replay the newest queued creature",
  );
});

Deno.test("DiscoveryReplayQueue - isReplayInProgress returns correct state", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  // deno-lint-ignore no-explicit-any
  let replayResolve: any = null;

  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: async (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ) => {
      await new Promise<void>((resolve) => {
        replayResolve = resolve;
      });

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

  assertEquals(
    queue.isReplayInProgress(),
    false,
    "No replay should be in progress initially",
  );

  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
  });

  // Wait a tick for replay to start
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(
    queue.isReplayInProgress(),
    true,
    "Replay should be in progress",
  );

  // Complete the replay
  if (replayResolve) {
    replayResolve();
  }

  await queue.waitForCompletion();

  assertEquals(
    queue.isReplayInProgress(),
    false,
    "No replay should be in progress after completion",
  );
});

Deno.test("DiscoveryReplayQueue - clearCompletedResults removes results", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ) => {
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        improvement: {
          key: "test-key",
          changeType: "add-synapses",
          error: 0.4,
          score: 0.6,
          scoreDelta: 0.1,
          message: "Improved!",
          creature: creature.exportJSON(),
        },
        evaluatedSingles: 1,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
  });

  await queue.waitForCompletion();

  assertEquals(
    queue.getCompletedResults().length,
    1,
    "Should have one result",
  );

  queue.clearCompletedResults();

  assertEquals(
    queue.getCompletedResults().length,
    0,
    "Results should be cleared",
  );
});

/**
 * Tests for Issue #1113: Discovery replay timeout handling.
 *
 * These tests verify that:
 * 1. Replay is skipped when remaining time is below the minimum threshold
 * 2. Timeout is passed to the replay function correctly
 * 3. Timeout is capped to the configured maximum
 */

Deno.test("DiscoveryReplayQueue - skips replay when remaining time is below minimum threshold", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let replayAttempted = false;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
      _timeoutMinutes?: number,
    ): Promise<DiscoveryReplayDirResult> => {
      replayAttempted = true;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // Schedule replay with remaining time below the default minimum (1 minute)
  // Default minimum is 1 minute, so 0.5 should be skipped
  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
  }, 0.5); // 0.5 minutes remaining

  await queue.waitForCompletion();

  assertEquals(
    replayAttempted,
    false,
    "Replay should be skipped when remaining time is below minimum threshold",
  );
});

Deno.test("DiscoveryReplayQueue - passes timeout to replay function", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let receivedTimeout: number | undefined;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
      timeoutMinutes?: number,
    ): Promise<DiscoveryReplayDirResult> => {
      receivedTimeout = timeoutMinutes;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // Schedule replay with 10 minutes remaining
  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
    discoveryReplayTimeoutMinutes: 15, // Configure 15 min max timeout
  }, 10); // 10 minutes remaining

  await queue.waitForCompletion();

  // Timeout should be capped to the minimum of remaining time (10) and configured timeout (15)
  assertEquals(
    receivedTimeout,
    10,
    "Timeout should be the minimum of remaining time and configured timeout",
  );
});

Deno.test("DiscoveryReplayQueue - caps timeout to configured maximum", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let receivedTimeout: number | undefined;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
      timeoutMinutes?: number,
    ): Promise<DiscoveryReplayDirResult> => {
      receivedTimeout = timeoutMinutes;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // Schedule replay with 30 minutes remaining but configured timeout is 5 minutes
  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
    discoveryReplayTimeoutMinutes: 5, // Configure 5 min max timeout
  }, 30); // 30 minutes remaining

  await queue.waitForCompletion();

  // Timeout should be capped to the configured maximum (5)
  assertEquals(
    receivedTimeout,
    5,
    "Timeout should be capped to the configured maximum",
  );
});

Deno.test("DiscoveryReplayQueue - uses default timeout when no remaining time provided", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let receivedTimeout: number | undefined;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
      timeoutMinutes?: number,
    ): Promise<DiscoveryReplayDirResult> => {
      receivedTimeout = timeoutMinutes;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // Schedule replay without remaining time (undefined)
  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
    discoveryReplayTimeoutMinutes: 5, // Configure 5 min max timeout
  }); // No remaining time provided

  await queue.waitForCompletion();

  // Timeout should be the configured default (5)
  assertEquals(
    receivedTimeout,
    5,
    "Timeout should use the configured default when no remaining time provided",
  );
});

Deno.test("DiscoveryReplayQueue - custom minimum time threshold", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let replayAttempted = false;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
      _timeoutMinutes?: number,
    ): Promise<DiscoveryReplayDirResult> => {
      replayAttempted = true;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // Schedule replay with 1.5 minutes remaining but minimum threshold is 2 minutes
  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
    discoveryReplayMinTimeMinutes: 2, // Custom minimum: 2 minutes
  }, 1.5); // 1.5 minutes remaining

  await queue.waitForCompletion();

  assertEquals(
    replayAttempted,
    false,
    "Replay should be skipped when remaining time is below custom minimum threshold",
  );
});

Deno.test("DiscoveryReplayQueue - allows replay when remaining time equals minimum threshold", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "fittest-1";

  let replayAttempted = false;
  const mockDeps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
      _timeoutMinutes?: number,
    ): Promise<DiscoveryReplayDirResult> => {
      replayAttempted = true;
      return Promise.resolve({
        original: { error: 0.5, score: 0.5 },
        evaluatedSingles: 0,
        evaluatedCombos: 0,
        pruned: 0,
        skippedAlreadyApplied: 0,
        skippedNotApplicable: 0,
      });
    },
  };

  const queue = new DiscoveryReplayQueue(mockDeps);

  // Schedule replay with exactly the minimum threshold
  queue.scheduleReplay(creature, "/tmp/data", {
    discoveryCacheDir: "/tmp/cache",
    costOfGrowth: 0,
    discoveryReplayMinTimeMinutes: 1, // Minimum: 1 minute
  }, 1); // Exactly 1 minute remaining

  await queue.waitForCompletion();

  assertEquals(
    replayAttempted,
    true,
    "Replay should be allowed when remaining time equals minimum threshold",
  );
});
