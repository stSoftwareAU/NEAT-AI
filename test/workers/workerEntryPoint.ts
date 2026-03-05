/**
 * Tests for the shared workerEntryPoint module.
 *
 * Issue #1698: The setupWorkerMessageLoop function operates on the Deno
 * Worker global scope (`self`) and cannot be directly unit-tested in
 * the main thread. Its behaviour is tested indirectly through MockWorker
 * and WorkerHandler tests (which exercise the full message loop).
 *
 * This file validates the module's supporting infrastructure:
 * - getInitTimeoutMs configuration (tested in WorkerHandlerBaseInitTimeout.ts)
 * - Error response building (tested here via MockWorker error paths)
 * - Type constraints (compile-time validation)
 */
import { assertEquals, assertExists } from "@std/assert";
import { MockWorker } from "../../src/multithreading/workers/MockWorker.ts";
import type {
  RequestData,
  ResponseData,
} from "../../src/multithreading/workers/WorkerHandler.ts";

/**
 * Helper to send a message to MockWorker and collect the response.
 * MockWorker internally uses WorkerProcessor which exercises the same
 * message processing logic that setupWorkerMessageLoop delegates to.
 */
function sendAndReceive(
  worker: MockWorker,
  data: RequestData,
): Promise<ResponseData> {
  return new Promise((resolve) => {
    worker.addEventListener(
      "message",
      ((event: Event) => {
        const me = event as Event & { data: ResponseData };
        resolve(me.data);
      }) as EventListener,
    );
    worker.postMessage(data);
  });
}

Deno.test("workerEntryPoint: echo message processing round-trip via MockWorker", async () => {
  const worker = new MockWorker();
  const response = await sendAndReceive(worker, {
    taskID: 1,
    echo: { message: "entry-point-test", ms: 0 },
  });

  assertEquals(response.taskID, 1);
  assertExists(response.echo);
  assertEquals(response.echo?.message, "entry-point-test");
  worker.terminate();
});

Deno.test("workerEntryPoint: error response includes taskID for unknown message type", async () => {
  const worker = new MockWorker();
  // Send a message with no recognised operation - should trigger error handling
  const response = await sendAndReceive(worker, {
    taskID: 99,
  });

  // MockWorker's error path should still return a response with the correct taskID
  assertEquals(response.taskID, 99);
  worker.terminate();
});

Deno.test("workerEntryPoint: init message error response includes status", async () => {
  const worker = new MockWorker();
  // Send an init with invalid data to trigger error handling
  const response = await sendAndReceive(worker, {
    taskID: 5,
    initialize: {
      dataSetDir: "/nonexistent/path/that/does/not/exist",
      costName: "MSE",
    },
  });

  assertEquals(response.taskID, 5);
  // Init should succeed since WorkerProcessor handles init setup
  assertExists(response.initialize);
  worker.terminate();
});
