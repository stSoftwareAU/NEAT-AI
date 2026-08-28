/**
 * GRQ #4490: the scheduler captures the creature it hands to a training task.
 *
 * A task whose worker promise never settles is force-abandoned by the watchdog
 * and leaves no evidence but its task id. Resolving that id against the saved
 * population misses almost every hang — the population has moved on by the
 * time the run ends. These tests lock the replacement: the creature is written
 * at dispatch and removed when the task settles, so the files left behind are
 * exactly the tasks that never returned.
 */
import { assert, assertEquals } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Creature } from "@creature";
import type { Neat } from "@neat/Neat.ts";
import { scheduleTraining } from "@neat/NeatScheduling.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import {
  resetTrainingTaskCaptureFaultReporting,
  TRAINING_TASK_CAPTURE_DIR_ENV,
  trainingTaskCapturePath,
  trainingTaskId,
} from "@neat/TrainingTaskCapture.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** A worker whose training promise settles (or never does) on demand. */
class StubWorker {
  trainCalls = 0;
  private settle?: () => void;

  constructor(private readonly hangs: boolean) {}

  train(): Promise<never> {
    this.trainCalls++;
    if (this.hangs) {
      // The hung case: the promise never settles, exactly as a wedged worker.
      return new Promise<never>(() => {});
    }
    return new Promise<never>((_resolve, reject) => {
      // Settling with a failure exercises the .catch() arm; the capture must
      // be dropped for any settled task, not just a successful one.
      this.settle = () => reject(new Error("worker refused the task"));
    });
  }

  /** Settle the outstanding task and let its handlers run. */
  async complete(): Promise<void> {
    this.settle?.();
    // Two turns: one for the rejection handler, one for the finally handler.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
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
    recordTrainingFailure: () => {},
  } as unknown as Neat;
}

async function withCaptureDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = Deno.makeTempDirSync({ prefix: "training-task-capture-" });
  const previous = Deno.env.get(TRAINING_TASK_CAPTURE_DIR_ENV);
  Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, dir);
  resetTrainingTaskCaptureFaultReporting();
  try {
    await fn(dir);
  } finally {
    if (previous === undefined) {
      Deno.env.delete(TRAINING_TASK_CAPTURE_DIR_ENV);
    } else {
      Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, previous);
    }
    Deno.removeSync(dir, { recursive: true });
  }
}

Deno.test("a task that never settles leaves its creature in the capture directory", async () => {
  await initWasmForTests();
  await withCaptureDir(async (dir) => {
    const worker = new StubWorker(true);
    const neat = createStubNeat(worker);
    const creature = new Creature(3, 1);
    const uuid = CreatureUtil.makeUUID(creature);

    scheduleTraining(neat, creature, 5);
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(worker.trainCalls, 1, "The task should have been dispatched");
    const path = trainingTaskCapturePath(dir, uuid);
    const captured = JSON.parse(Deno.readTextFileSync(path));
    assertEquals(
      captured.input,
      3,
      "The capture must be the dispatched creature's own export",
    );
    assertEquals(
      CreatureUtil.makeUUID(Creature.fromJSON(captured)),
      uuid,
      "The capture must round-trip to the uuid the watchdog reports",
    );
    assert(
      path.endsWith(`${trainingTaskId(uuid)}.json`),
      "The capture must be keyed by the id the watchdog logs",
    );
  });
});

Deno.test("a task that settles removes its own capture", async () => {
  await initWasmForTests();
  await withCaptureDir(async (dir) => {
    const worker = new StubWorker(false);
    const neat = createStubNeat(worker);
    const creature = new Creature(4, 1);
    const uuid = CreatureUtil.makeUUID(creature);

    scheduleTraining(neat, creature, 5);
    await new Promise((r) => setTimeout(r, 0));
    assertEquals(
      Deno.statSync(trainingTaskCapturePath(dir, uuid)).isFile,
      true,
      "The creature is captured for the whole in-flight window",
    );

    await worker.complete();

    let stillThere = true;
    try {
      Deno.statSync(trainingTaskCapturePath(dir, uuid));
    } catch (err) {
      stillThere = !(err instanceof Deno.errors.NotFound);
    }
    assertEquals(
      stillThere,
      false,
      "A settled task returned a result, so it is not evidence of a hang",
    );
    assertEquals(
      [...Deno.readDirSync(dir)].length,
      0,
      "Nothing but hung tasks may survive in the capture directory",
    );
  });
});

Deno.test("capture is off, and costs nothing, when no directory is configured", async () => {
  await initWasmForTests();
  const previous = Deno.env.get(TRAINING_TASK_CAPTURE_DIR_ENV);
  Deno.env.delete(TRAINING_TASK_CAPTURE_DIR_ENV);
  const probe = Deno.makeTempDirSync({ prefix: "training-task-capture-off-" });
  try {
    const worker = new StubWorker(true);
    const neat = createStubNeat(worker);
    const creature = new Creature(2, 1);

    scheduleTraining(neat, creature, 5);
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(worker.trainCalls, 1, "Dispatch must be unaffected");
    assertEquals(
      [...Deno.readDirSync(probe)].length,
      0,
      "No capture may be written when the feature is not configured",
    );
  } finally {
    if (previous !== undefined) {
      Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, previous);
    }
    Deno.removeSync(probe, { recursive: true });
  }
});

Deno.test("an unwritable capture directory never blocks a training dispatch", async () => {
  await initWasmForTests();
  const previous = Deno.env.get(TRAINING_TASK_CAPTURE_DIR_ENV);
  // A path whose parent is a regular file can never be created.
  const file = Deno.makeTempFileSync({ prefix: "training-task-capture-" });
  Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, `${file}/captures`);
  resetTrainingTaskCaptureFaultReporting();
  try {
    const worker = new StubWorker(true);
    const neat = createStubNeat(worker);
    const creature = new Creature(2, 1);
    const uuid = CreatureUtil.makeUUID(creature);

    scheduleTraining(neat, creature, 5);
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(
      worker.trainCalls,
      1,
      "A diagnostic must never stop the run training",
    );
    assert(
      neat.trainingInProgress.has(uuid),
      "The task is still tracked as in flight",
    );
  } finally {
    if (previous === undefined) {
      Deno.env.delete(TRAINING_TASK_CAPTURE_DIR_ENV);
    } else {
      Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, previous);
    }
    Deno.removeSync(file);
  }
});
