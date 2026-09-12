/**
 * Issue #4022 (GRQ #4490 / #4794): the creature handed to a training task is
 * kept on disk while the task is in flight and removed when it settles, so a
 * hung task leaves exactly the creature that reproduces the hang.
 */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { Neat } from "@neat/Neat.ts";
import { scheduleTraining } from "@neat/NeatScheduling.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import {
  removeTrainingTaskCapture,
  TRAINING_TASK_CAPTURE_DIR_ENV,
  trainingTaskCaptureDir,
  trainingTaskCapturePath,
  writeTrainingTaskCapture,
} from "@neat/TrainingTaskCapture.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";
import { WorkerTaskCancelledError } from "@workers/WorkerTaskCancelledError.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** A worker whose reply the test settles when it chooses. */
class DeferredWorker {
  private settle: ((r: ResponseData) => void) | undefined;
  private reject: ((e: Error) => void) | undefined;
  trainTracked(
    _creature: Creature,
    _options: TrainOptions,
  ): { taskID: number; response: Promise<ResponseData> } {
    return {
      taskID: 7,
      response: new Promise<ResponseData>((resolve, reject) => {
        this.settle = resolve;
        this.reject = reject;
      }),
    };
  }
  /** Settle with a reply the scheduler treats as a failed task. */
  fail(): void {
    this.settle?.({
      taskID: 7,
      duration: 1,
      error: { name: "Error", message: "worker failed (test)" },
    } as ResponseData);
  }
  /** Settle the way the stuck-task watchdog does: cancelled, no reply. */
  cancel(): void {
    this.reject?.(
      new WorkerTaskCancelledError({
        taskID: 7,
        workerID: 3,
        elapsedMs: 331245,
        reason: "training task passed its per-task deadline without returning",
      }),
    );
  }
}

function createStubNeat(worker: DeferredWorker): Neat {
  const pool = { selectWorker: () => worker, getIdleWorkers: () => [] };
  return {
    config: createNeatConfig({}),
    hardDeadlineTS: 0,
    abandonEpoch: 0,
    trainingInProgress: new Map(),
    trainingDeadlines: new Map(),
    trainingTasks: new Map(),
    alreadyScheduledMap: new Map<string, number>(),
    trainingRegressionTracker: new TrainingRegressionTracker(),
    heavyWorkerPool: pool,
    fastWorkerPool: pool,
    isRunAbandonedSince: () => false,
    recordTrainingComplete: () => {},
  } as unknown as Neat;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Poll until the file is (or is not) there, up to ~1 s. */
async function waitForFile(
  path: string,
  present: boolean,
  attempts = 100,
): Promise<boolean> {
  if ((await fileExists(path)) === present) return true;
  if (attempts <= 0) return false;
  await new Promise((r) => setTimeout(r, 10));
  return waitForFile(path, present, attempts - 1);
}

Deno.test("capture path uses the watchdog's eight-character task id", () => {
  assertEquals(
    trainingTaskCapturePath("/tmp/x", "abcdef0123456789-3f0bcfe2"),
    join("/tmp/x", "training-task-3f0bcfe2.json"),
  );
  assertEquals(trainingTaskCaptureDir(() => undefined), undefined);
  assertEquals(trainingTaskCaptureDir(() => ""), undefined);
  assertEquals(trainingTaskCaptureDir(() => "/d"), "/d");
});

Deno.test("write then remove; a missing file on remove is not an error", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = await writeTrainingTaskCapture(dir, "uuid-deadbeef", { a: 1 });
    assertEquals(path, join(dir, "training-task-deadbeef.json"));
    assertEquals(await Deno.readTextFile(path!), '{"a":1}');
    await removeTrainingTaskCapture(path!);
    await removeTrainingTaskCapture(path!);
    assertEquals(
      await writeTrainingTaskCapture(join(dir, "missing"), "u", {}),
      undefined,
      "an unwritable capture is reported, not thrown",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a dispatched task is captured until it settles", async () => {
  await initWasmForTests();
  const dir = await Deno.makeTempDir();
  const previous = Deno.env.get(TRAINING_TASK_CAPTURE_DIR_ENV);
  Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, dir);
  try {
    const worker = new DeferredWorker();
    const neat = createStubNeat(worker);
    const creature = new Creature(2, 1);
    const uuid = CreatureUtil.makeUUID(creature);
    const path = trainingTaskCapturePath(dir, uuid);

    scheduleTraining(neat, creature, 5);
    assert(await waitForFile(path, true), "capture written at dispatch");
    const captured = JSON.parse(await Deno.readTextFile(path));
    assertEquals(captured.input, 2);
    assertEquals(captured.output, 1);

    worker.fail();
    await Promise.allSettled(neat.trainingInProgress.values());
    assert(await waitForFile(path, false), "capture removed once settled");
  } finally {
    if (previous === undefined) Deno.env.delete(TRAINING_TASK_CAPTURE_DIR_ENV);
    else Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, previous);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a cancelled task keeps its capture — that is the hung set (GRQ #4794)", async () => {
  await initWasmForTests();
  const dir = await Deno.makeTempDir();
  const previous = Deno.env.get(TRAINING_TASK_CAPTURE_DIR_ENV);
  Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, dir);
  try {
    const worker = new DeferredWorker();
    const neat = createStubNeat(worker);
    const creature = new Creature(2, 1);
    const uuid = CreatureUtil.makeUUID(creature);
    const path = trainingTaskCapturePath(dir, uuid);

    scheduleTraining(neat, creature, 5);
    assert(await waitForFile(path, true), "capture written at dispatch");

    // GRQ #4489 cancels exactly the tasks the stuck-task watchdog abandoned,
    // so this settle is the hang, not an answer.
    worker.cancel();
    await Promise.allSettled(neat.trainingInProgress.values());
    // Give the removal every chance to run before asserting it did not.
    await new Promise((r) => setTimeout(r, 50));
    assert(
      await fileExists(path),
      "the creature that hung must survive the cancellation — deleting it " +
        "leaves GRQ with captured=0 atSchedule=0 and nothing to reproduce",
    );
  } finally {
    if (previous === undefined) Deno.env.delete(TRAINING_TASK_CAPTURE_DIR_ENV);
    else Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, previous);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("nothing is written while the capture is not armed", async () => {
  await initWasmForTests();
  const dir = await Deno.makeTempDir();
  const previous = Deno.env.get(TRAINING_TASK_CAPTURE_DIR_ENV);
  Deno.env.delete(TRAINING_TASK_CAPTURE_DIR_ENV);
  try {
    const worker = new DeferredWorker();
    const neat = createStubNeat(worker);
    const creature = new Creature(2, 1);
    scheduleTraining(neat, creature, 5);
    worker.fail();
    await Promise.allSettled(neat.trainingInProgress.values());
    let count = 0;
    for await (const _ of Deno.readDir(dir)) count++;
    assertEquals(count, 0);
  } finally {
    if (previous !== undefined) {
      Deno.env.set(TRAINING_TASK_CAPTURE_DIR_ENV, previous);
    }
    await Deno.remove(dir, { recursive: true });
  }
});
