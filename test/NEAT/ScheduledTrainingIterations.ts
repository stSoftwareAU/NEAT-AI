/**
 * Issue #3776: a scheduled per-generation training task must run more than a
 * single epoch.
 *
 * With one epoch there is no earlier epoch to compare against, so the training
 * loop can never reject an epoch that made the creature worse — GRQ #4063 saw
 * every scheduled backprop regress (~13× error) and be discarded downstream,
 * burning a heavy worker slot each time. Scheduling at least two epochs lets
 * the loop's own regression guard revert a bad epoch before the result leaves
 * the worker.
 */
import { assert } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { TrainOptions } from "@config/TrainOptions.ts";
import { Creature } from "@creature";
import type { Neat } from "@neat/Neat.ts";
import { scheduleTraining } from "@neat/NeatScheduling.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** Captures the training options handed to the worker. */
class CapturingWorker {
  lastOptions: TrainOptions | undefined;

  /** GRQ #4489: dispatch is tracked so the task can be cancelled. */
  trainTracked(
    _creature: Creature,
    options: TrainOptions,
  ): { taskID: number; response: Promise<never> } {
    this.lastOptions = options;
    // Never settles: the test only inspects the dispatched request.
    return { taskID: 1, response: new Promise<never>(() => {}) };
  }
}

function createStubNeat(worker: CapturingWorker): Neat {
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
    // GRQ #4489: the cancellable handle for each in-flight training task.
    trainingTasks: new Map(),
    alreadyScheduledMap: new Map<string, number>(),
    trainingRegressionTracker: new TrainingRegressionTracker(),
    heavyWorkerPool: pool,
    fastWorkerPool: pool,
    isRunAbandonedSince: () => false,
    recordTrainingComplete: () => {},
  } as unknown as Neat;
}

Deno.test("scheduleTraining requests at least two training epochs", async () => {
  await initWasmForTests();
  const worker = new CapturingWorker();
  const neat = createStubNeat(worker);

  scheduleTraining(neat, new Creature(2, 1), 5);

  const options = worker.lastOptions;
  assert(options, "Training should have been dispatched");
  assert(
    (options.iterations ?? 0) >= 2,
    `Scheduled training must run at least 2 epochs, got ${options.iterations}`,
  );
});
