/**
 * Issue #2828 / #2910: DiscoveryReplayQueue must honour the seed warm-up
 * structural lock. While the warm-up window is active, replay of cached
 * structural discoveries must not run (replay can prune/rewire topology).
 * Once warm-up has elapsed, replay resumes as normal.
 *
 * Issue #2910: the lock state is read from Neat-level warm-up context passed
 * by the caller, NOT from per-creature warm-up tags. This keeps the gate
 * correct once mid-run creatures stop carrying warm-up tags (#2911) — an
 * untagged creature inside an active warm-up window must still be locked.
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

Deno.test("DiscoveryReplayWarmup: skips replay during warm-up window (Neat context)", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "warmup-locked";

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS, undefined, {
    warmupGenerations: 1440,
    currentGeneration: 100,
  });
  await queue.waitForCompletion();

  assertEquals(calls(), 0, "Replay must not run while warm-up lock is active");
});

Deno.test("DiscoveryReplayWarmup: untagged creature during warm-up stays locked", async () => {
  // Regression for #2910: the creature carries NO warm-up tags (as mid-run
  // creatures will once #2911 lands). The lock must still be active because
  // the Neat-level context says warm-up has not elapsed.
  const creature = makeBaseCreature();
  creature.uuid = "warmup-untagged";

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS, undefined, {
    warmupGenerations: 1440,
    currentGeneration: 5,
  });
  await queue.waitForCompletion();

  assertEquals(
    calls(),
    0,
    "Untagged creature must stay locked during active warm-up window",
  );
});

Deno.test("DiscoveryReplayWarmup: conservative lock when generation unknown", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "warmup-no-gen";

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  // Warm-up configured but current generation unknown (<= 0) → stay locked.
  queue.scheduleReplay(creature, "/tmp/data", OPTIONS, undefined, {
    warmupGenerations: 1440,
    currentGeneration: 0,
  });
  await queue.waitForCompletion();

  assertEquals(calls(), 0, "Conservative lock must block replay");
});

Deno.test("DiscoveryReplayWarmup: replays once warm-up has elapsed (Neat context)", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "warmup-elapsed";

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS, undefined, {
    warmupGenerations: 10,
    currentGeneration: 11,
  });
  await queue.waitForCompletion();

  assertEquals(calls(), 1, "Replay must run after warm-up elapses");
});

Deno.test("DiscoveryReplayWarmup: replays when no warm-up configured", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "no-warmup";

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS, undefined, {
    warmupGenerations: 0,
    currentGeneration: 50,
  });
  await queue.waitForCompletion();

  assertEquals(calls(), 1, "Replay must run when no warm-up is configured");
});

Deno.test("DiscoveryReplayWarmup: replays when no warm-up context supplied", async () => {
  const creature = makeBaseCreature();
  creature.uuid = "no-context";

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS);
  await queue.waitForCompletion();

  assertEquals(
    calls(),
    1,
    "Replay must run when no warm-up context is supplied",
  );
});

Deno.test("DiscoveryReplayWarmup: per-creature tags are ignored in favour of Neat context", async () => {
  // The creature is tagged as if warm-up has elapsed, but the Neat-level
  // context says the lock is active. The context must win.
  const creature = makeBaseCreature();
  creature.uuid = "tags-ignored";
  addTag(creature, WARMUP_GENERATIONS_TAG, "10");
  addTag(creature, CURRENT_GENERATION_TAG, "999");

  const { deps, calls } = trackingDeps();
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS, undefined, {
    warmupGenerations: 1440,
    currentGeneration: 100,
  });
  await queue.waitForCompletion();

  assertEquals(
    calls(),
    0,
    "Neat-level context must override per-creature warm-up tags",
  );
});
