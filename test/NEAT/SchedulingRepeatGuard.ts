/**
 * Issue #3553: `scheduleTraining()` never re-dispatches a creature that has
 * already been scheduled this run.
 *
 * The guard used to be conditional on the unused `enableRepetitiveTraining`
 * flag, which defaulted to `false` — so in every production run the branch
 * returned unconditionally. These tests lock that behaviour in now the flag
 * is gone.
 */
import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Creature } from "@creature";
import type { Neat } from "@neat/Neat.ts";
import { scheduleTraining } from "@neat/NeatScheduling.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** Records how many times a training task was dispatched to a worker. */
class StubWorker {
  trainCalls = 0;

  train(): Promise<never> {
    this.trainCalls++;
    // Never settles: the test only cares about dispatch, not the outcome.
    // A pending promise leaks no ops or resources.
    return new Promise<never>(() => {});
  }
}

function createStubNeat(worker: StubWorker): Neat {
  const pool = {
    selectWorker: () => worker,
    getIdleWorkers: () => [],
  };
  return {
    config: createNeatConfig({}),
    hardDeadlineTS: 0,
    abandonEpoch: 0,
    trainingInProgress: new Map(),
    trainingDeadlines: new Map(),
    alreadyScheduledMap: new Map<string, number>(),
    trainingRegressionTracker: new TrainingRegressionTracker(),
    heavyWorkerPool: pool,
    fastWorkerPool: pool,
    isRunAbandonedSince: () => false,
    recordTrainingComplete: () => {},
  } as unknown as Neat;
}

Deno.test("scheduleTraining dispatches a creature seen for the first time", async () => {
  await initWasmForTests();
  const worker = new StubWorker();
  const neat = createStubNeat(worker);
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);

  scheduleTraining(neat, creature, 5);

  assertEquals(worker.trainCalls, 1, "First schedule should dispatch");
  assert(
    neat.alreadyScheduledMap.has(uuid),
    "Dispatch should record the creature as scheduled",
  );
});

Deno.test("scheduleTraining skips a creature already scheduled this run", async () => {
  await initWasmForTests();
  const worker = new StubWorker();
  const neat = createStubNeat(worker);
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);

  // Previously scheduled, but no longer in flight (the run completed it).
  neat.alreadyScheduledMap.set(uuid, Date.now());

  scheduleTraining(neat, creature, 5);

  assertEquals(
    worker.trainCalls,
    0,
    "An already-scheduled creature must never be re-dispatched",
  );
});
