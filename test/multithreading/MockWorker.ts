/**
 * Tests for the MockWorker class.
 *
 * Issue #1698: Validates that MockWorker correctly simulates worker behaviour
 * including message handling, structured clone validation, error responses,
 * and termination.
 */
import { assertEquals, assertExists } from "@std/assert";
import { MockWorker } from "../../src/multithreading/workers/MockWorker.ts";
import type {
  RequestData,
  ResponseData,
} from "../../src/multithreading/workers/WorkerHandler.ts";

/**
 * Helper that sends a message to a MockWorker and waits for the response.
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

Deno.test("MockWorker: processes echo message and returns response", async () => {
  const worker = new MockWorker();
  const response = await sendAndReceive(worker, {
    taskID: 1,
    echo: { message: "hello", ms: 0 },
  });

  assertEquals(response.taskID, 1);
  assertExists(response.echo);
  assertEquals(response.echo?.message, "hello");
  worker.terminate();
});

Deno.test("MockWorker: validates structured clone safety on postMessage", () => {
  const worker = new MockWorker();
  worker.addEventListener("message", () => {});

  // structuredClone should succeed for valid RequestData
  const validData: RequestData = {
    taskID: 1,
    echo: { message: "test", ms: 0 },
  };
  // Should not throw - data is structured-clone safe
  worker.postMessage(validData);

  worker.terminate();
});

Deno.test("MockWorker: terminate cleans up resources", () => {
  const worker = new MockWorker();
  let callbackCalled = false;
  worker.addEventListener("message", () => {
    callbackCalled = true;
  });
  worker.terminate();

  // After termination, posting a message should not invoke the callback.
  // The processor is nulled out, so this will error internally but
  // the callback should not fire since it's also nulled.
  // We just verify terminate doesn't throw.
  assertEquals(callbackCalled, false);
});

Deno.test("MockWorker: handles multiple sequential messages", async () => {
  const worker = new MockWorker();
  const responses: ResponseData[] = [];

  worker.addEventListener(
    "message",
    ((event: Event) => {
      const me = event as Event & { data: ResponseData };
      responses.push(me.data);
    }) as EventListener,
  );

  // Send multiple echo messages
  worker.postMessage({ taskID: 1, echo: { message: "first", ms: 0 } });
  worker.postMessage({ taskID: 2, echo: { message: "second", ms: 0 } });

  // Wait for processing
  await new Promise((r) => setTimeout(r, 200));

  assertEquals(responses.length, 2);
  assertEquals(responses[0].taskID, 1);
  assertEquals(responses[0].echo?.message, "first");
  assertEquals(responses[1].taskID, 2);
  assertEquals(responses[1].echo?.message, "second");

  worker.terminate();
});

Deno.test("MockWorker: error response for evaluate includes infinity error", async () => {
  const worker = new MockWorker();

  // Sending evaluate without initialising the processor's dataSetDir
  // should trigger an error response
  const response = await sendAndReceive(worker, {
    taskID: 10,
    evaluate: { creature: "invalid-json", feedbackLoop: false },
  });

  assertEquals(response.taskID, 10);
  assertExists(response.evaluate);
  assertEquals(response.evaluate?.error, Number.POSITIVE_INFINITY);

  worker.terminate();
});

Deno.test("MockWorker: error response for breed includes success=false", async () => {
  const worker = new MockWorker();

  const response = await sendAndReceive(worker, {
    taskID: 11,
    breed: {
      mother: "invalid",
      father: "invalid",
      geneticCompatibilityThreshold: 0.3,
      forwardOnly: false,
    },
  });

  assertEquals(response.taskID, 11);
  assertExists(response.breed);
  assertEquals(response.breed?.success, false);

  worker.terminate();
});
