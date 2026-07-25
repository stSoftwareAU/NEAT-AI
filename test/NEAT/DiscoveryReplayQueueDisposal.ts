import { assert, assertEquals } from "@std/assert";
import type { Creature } from "@creature";
import type { DiscoveryReplayDirResult } from "@discovery/DiscoveryReplayRunner.ts";
import {
  DiscoveryReplayQueue,
  type DiscoveryReplayQueueDeps,
} from "@neat/DiscoveryReplayQueue.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { makeBaseCreature } from "../fixtures/SimpleCreatures.ts";

/**
 * Tests for Issue #3435 — the DiscoveryReplayQueue must release its creature
 * clones promptly on completion, supersession, and hard-cap timeout so full
 * topologies are not retained across generations.
 *
 * `Creature.dispose()` empties `neurons`/`synapses`, so a disposed clone reads
 * as `neurons.length === 0`. Assertions are behavioural (topology released),
 * never elapsed-time measurements.
 */

const OK_RESULT: DiscoveryReplayDirResult = {
  original: { error: 0.5, score: 0.5 },
  evaluatedSingles: 0,
  evaluatedCombos: 0,
  pruned: 0,
  skippedAlreadyApplied: 0,
  skippedNotApplicable: 0,
};

const OPTIONS: NeatOptions = {
  discoveryCacheDir: "/tmp/cache",
  costOfGrowth: 0,
};

Deno.test("DiscoveryReplayQueue - disposes the replay clone on completion", async () => {
  let captured: Creature | undefined;
  const deps: DiscoveryReplayQueueDeps = {
    replayDir: (creature: Creature) => {
      captured = creature;
      return Promise.resolve(OK_RESULT);
    },
  };
  const queue = new DiscoveryReplayQueue(deps);

  const creature = makeBaseCreature();
  assert(creature.neurons.length > 0, "fixture must start with neurons");

  queue.scheduleReplay(creature, "/tmp/data", OPTIONS);
  await queue.waitForCompletion();

  assert(captured, "replay clone should have been passed to replayDir");
  assertEquals(
    captured!.neurons.length,
    0,
    "the replay clone must be disposed once the replay completes",
  );
  // The caller's original creature must remain intact (only the clone is freed).
  assert(
    creature.neurons.length > 0,
    "disposing the clone must not touch the caller's creature",
  );
});

Deno.test("DiscoveryReplayQueue - disposes the replay clone on failure", async () => {
  let captured: Creature | undefined;
  const deps: DiscoveryReplayQueueDeps = {
    replayDir: (creature: Creature) => {
      captured = creature;
      return Promise.reject(new Error("boom"));
    },
  };
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(makeBaseCreature(), "/tmp/data", OPTIONS);
  await queue.waitForCompletion();

  assert(captured, "replay clone should have been passed to replayDir");
  assertEquals(
    captured!.neurons.length,
    0,
    "the replay clone must be disposed even when the replay fails",
  );
});

Deno.test("DiscoveryReplayQueue - disposes a superseded queued clone", async () => {
  const started: Creature[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const deps: DiscoveryReplayQueueDeps = {
    replayDir: async (creature: Creature) => {
      started.push(creature);
      // Hold the first replay open so the next two schedules queue behind it.
      if (started.length === 1) {
        await gate;
      }
      return OK_RESULT;
    },
  };
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(makeBaseCreature(), "/tmp/data", OPTIONS); // starts
  queue.scheduleReplay(makeBaseCreature(), "/tmp/data", OPTIONS); // queued #1
  // Queued #2 supersedes #1; the dropped #1 clone is disposed on supersession.
  queue.scheduleReplay(makeBaseCreature(), "/tmp/data", OPTIONS);

  release();
  await queue.waitForCompletion();

  // Exactly two replays ran (the first, then the surviving queued creature);
  // the superseded queued clone was dropped without a third replay.
  assertEquals(
    started.length,
    2,
    "only the surviving queued replay should run",
  );
  for (const c of started) {
    assertEquals(
      c.neurons.length,
      0,
      "every started replay clone must be disposed on completion",
    );
  }
});

Deno.test("DiscoveryReplayQueue - disposes the queued clone dropped at the hard cap", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: Creature[] = [];

  const deps: DiscoveryReplayQueueDeps = {
    replayDir: async (creature: Creature) => {
      started.push(creature);
      if (started.length === 1) {
        await gate; // keep the first replay in-flight past the cap
      }
      return OK_RESULT;
    },
  };
  const queue = new DiscoveryReplayQueue(deps);

  queue.scheduleReplay(makeBaseCreature(), "/tmp/data", OPTIONS); // starts
  queue.scheduleReplay(makeBaseCreature(), "/tmp/data", OPTIONS); // queued

  // Hard cap already passed → waitForCompletion drops the queued clone and
  // aborts the in-flight replay without starting the queued one.
  await queue.waitForCompletion(Date.now() - 1);

  assertEquals(
    started.length,
    1,
    "the queued replay must not start after the hard cap",
  );

  // Let the in-flight replay settle so the test leaks no timers/promises.
  release();
  await queue.waitForCompletion();

  assertEquals(
    started.length,
    1,
    "the dropped queued clone stays dropped after the cap",
  );
});
