/**
 * A `train` task whose dataset directory has been removed must fail loudly as
 * the task it is, not be logged and continued past (GRQ #4609).
 *
 * `GRQ-11-nigel-20260901T030250Z.log`:
 *
 * ```
 * Worker processing error: DatasetError: training data directory .tmp/train
 *   disappeared mid-run
 *     at readDatasetDirEntriesSync (DatasetIO.ts:120:13)
 *     at dataFiles (TrainingSetup.ts:60:26)
 *     at trainDir (Training.ts:52:22)
 *   reason: "DIRECTORY_MISSING", path: ".tmp/train"
 * ```
 *
 * `trainDir` cannot pin a directory another process owns, so the contract is
 * the second one: the task fails, names the path, and is classified as a
 * failure the caller counts — never a quietly finished piece of work.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import { DatasetError } from "@errors/DatasetError.ts";
import { trainDir } from "@architecture/Training.ts";
import { WorkerProcessor } from "@multithreading/workers/WorkerProcessor.ts";
import { buildWorkerErrorResponse } from "@multithreading/workers/WorkerErrorResponse.ts";
import { isFailedTrainWorkerResponse } from "@neat/NeatScheduling.ts";
import type { RequestData } from "@multithreading/workers/WorkerHandler.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("trainDir names the dataset directory that vanished under it", async () => {
  await initWasmForTests();
  const creature = new Creature(1, 1);
  const dataDir = await Deno.makeTempDir({ prefix: "grq-4609-train-" });
  await Deno.remove(dataDir, { recursive: true });

  try {
    const error = (() => {
      try {
        trainDir(creature, dataDir, {}, Costs.find("MSE"));
        return undefined;
      } catch (e) {
        return e;
      }
    })();

    if (!(error instanceof DatasetError)) {
      throw new Error(
        `expected DatasetError, got ${error?.constructor?.name}: ${error}`,
      );
    }
    assertEquals(error.reason, "DIRECTORY_MISSING");
    assertEquals(error.path, dataDir);
  } finally {
    creature.dispose();
  }
});

Deno.test("a worker train task on a removed dataset directory fails the task, loudly", async () => {
  await initWasmForTests();
  const dataSetDir = await Deno.makeTempDir({ prefix: "grq-4609-worker-" });
  const processor = new WorkerProcessor();
  await processor.process({
    taskID: 1,
    initialize: { dataSetDir, costName: "MSE" },
  });

  // The teardown that owns the directory removes it while the task is queued.
  await Deno.remove(dataSetDir, { recursive: true });

  const creature = new Creature(1, 1);
  try {
    const request: RequestData = {
      taskID: 2,
      train: {
        creature: creature.exportJSON(),
        options: {},
      },
    };

    const error = await assertRejects(
      () => processor.process(request),
      DatasetError,
    );
    assertEquals(error.reason, "DIRECTORY_MISSING");
    assertEquals(error.path, dataSetDir);

    // What the worker sends back: a failure the scheduler counts, carrying the
    // real error and no fabricated training result.
    const response = buildWorkerErrorResponse(request, error, 1);
    assertEquals(response.error?.name, "DatasetError");
    assertEquals(response.train, undefined);
    assertEquals(isFailedTrainWorkerResponse(response), true);
  } finally {
    creature.dispose();
  }
});
