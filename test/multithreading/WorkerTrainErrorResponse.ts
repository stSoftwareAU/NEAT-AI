/**
 * WHAT-tests for Issue #3780 worker train-error handling.
 *
 * Asserts that a thrown train failure surfaces as ResponseData.error without a
 * fabricated blank creature (input: 0), and that NeatScheduling recognises the
 * failure shape before Creature.fromJSON.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { buildWorkerErrorResponse } from "@multithreading/workers/WorkerErrorResponse.ts";
import type { RequestData } from "@multithreading/workers/WorkerHandler.ts";
import { isFailedTrainWorkerResponse } from "@neat/NeatScheduling.ts";
import { MockWorker } from "@multithreading/workers/MockWorker.ts";

Deno.test("buildWorkerErrorResponse - train leaves train unset and keeps real error", () => {
  const data: RequestData = {
    taskID: 7,
    train: {
      creature: { input: 2, output: 1, neurons: [], synapses: [] },
      options: {},
    },
  };
  const response = buildWorkerErrorResponse(
    data,
    new TypeError('URL must be a file URL: received "https:"'),
    12,
  );

  assertEquals(response.taskID, 7);
  assertEquals(response.duration, 12);
  assertExists(response.error);
  assertEquals(response.error?.name, "TypeError");
  assert(
    response.error!.message.includes("file URL"),
    "root-cause message must be preserved",
  );
  assertEquals(
    response.train,
    undefined,
    "must not fabricate a blank train.creature with input: 0",
  );
});

Deno.test("isFailedTrainWorkerResponse - error field and missing train are failures", () => {
  assertEquals(
    isFailedTrainWorkerResponse({
      taskID: 1,
      duration: 0,
      error: { message: "boom" },
    }),
    true,
  );
  assertEquals(
    isFailedTrainWorkerResponse({
      taskID: 1,
      duration: 0,
    }),
    true,
  );
  assertEquals(
    isFailedTrainWorkerResponse({
      taskID: 1,
      duration: 0,
      train: {
        ID: "error",
        creature: { input: 0, output: 0, neurons: [], synapses: [] },
        error: Number.POSITIVE_INFINITY,
        trace: { input: 0, output: 0, neurons: [], synapses: [] },
      },
    }),
    true,
  );
});

Deno.test("isFailedTrainWorkerResponse - finite successful train is not a failure", () => {
  assertEquals(
    isFailedTrainWorkerResponse({
      taskID: 1,
      duration: 5,
      train: {
        ID: "ok",
        creature: { input: 2, output: 1, neurons: [], synapses: [] },
        error: 0.5,
        trace: { input: 2, output: 1, neurons: [], synapses: [] },
      },
    }),
    false,
  );
});

Deno.test("MockWorker - unknown train failure does not return input:0 creature", async () => {
  const worker = new MockWorker();
  const response = await new Promise<
    import("@multithreading/workers/WorkerHandler.ts").ResponseData
  >((resolve) => {
    worker.addEventListener(
      "message",
      ((event: Event) => {
        const me = event as Event & {
          data: import("@multithreading/workers/WorkerHandler.ts").ResponseData;
        };
        resolve(me.data);
      }) as EventListener,
    );
    // Uninitialised MockWorker train path throws inside WorkerProcessor.
    worker.postMessage({
      taskID: 42,
      train: {
        creature: { input: 2, output: 1, neurons: [], synapses: [] },
        options: { iterations: 1 },
      },
    });
  });

  assertEquals(response.taskID, 42);
  assertExists(response.error);
  assertEquals(response.train, undefined);
  assertEquals(isFailedTrainWorkerResponse(response), true);
  worker.terminate();
});
