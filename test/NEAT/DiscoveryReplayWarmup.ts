/**
 * Issue #2828: DiscoveryReplayQueue must honour the seed warm-up
 * structural lock. While a creature is within its warm-up window, replay
 * of cached structural discoveries must not run (replay can prune/rewire
 * topology). Once warm-up has elapsed, replay resumes as normal.
 */
import { assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import type { Creature } from "@creature";
import {
  DiscoveryReplayQueue,
  type DiscoveryReplayQueueDeps,
} from "@neat/DiscoveryReplayQueue.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import {
  CURRENT_GENERATION_TAG,
  WARMUP_GENERATIONS_TAG,
} from "@architecture/CreatureFactory.ts";
import { makeForwardOnlyCreature as makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

function trackingDeps(): {
  deps: DiscoveryReplayQueueDeps;
  calls: () => number;
} {
  let started = 0;
  const deps: DiscoveryReplayQueueDeps = {
    replayDir: (
      _creature: Creature,
      _dataDir: string,
      _options: NeatOptions,
    ) => {
      started++;
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
  return { deps, calls: () => started };
}

const OPTIONS: NeatOptions = {
  discoveryCacheDir: "/tmp/cache",
  costOfGrowth: 0,
};

Deno.test("DiscoveryReplayWarmup: skips replay during warm-up window", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "warmup-locked";
  addTag(creature, WARMUP_GENERATIONS_TAG, "1440");
  addTag(creature, CURRENT_GENERATION_TAG, "100");

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS);
  await queue.waitForCompletion();

  assertEquals(calls(), 0, "Replay must not run while warm-up lock is active");
});

Deno.test("DiscoveryReplayWarmup: skips replay when generation tag missing", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "warmup-no-gen";
  addTag(creature, WARMUP_GENERATIONS_TAG, "1440");
  // No currentGeneration tag — conservative lock must still block replay.

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS);
  await queue.waitForCompletion();

  assertEquals(calls(), 0, "Conservative lock must block replay");
});

Deno.test("DiscoveryReplayWarmup: replays once warm-up has elapsed", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "warmup-elapsed";
  addTag(creature, WARMUP_GENERATIONS_TAG, "10");
  addTag(creature, CURRENT_GENERATION_TAG, "11");

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS);
  await queue.waitForCompletion();

  assertEquals(calls(), 1, "Replay must run after warm-up elapses");
});

Deno.test("DiscoveryReplayWarmup: replays when no warm-up configured", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "no-warmup";

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS);
  await queue.waitForCompletion();

  assertEquals(calls(), 1, "Replay must run when no warm-up is configured");
});
