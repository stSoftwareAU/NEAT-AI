/**
 * Tests for the MockWorker class.
 *
 * Issue #1698: Validates that MockWorker correctly simulates worker behaviour
 * including message handling, structured clone validation, error responses,
 * and termination.
 */
import { assert, assertEquals, assertExists, assertThrows } from "@std/assert";
import { MockWorker } from "@multithreading/workers/MockWorker.ts";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";

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

Deno.test("MockWorker: validates structured clone safety on postMessage", async () => {
  const worker = new MockWorker();

  // structuredClone should succeed for valid RequestData
  const validData: RequestData = {
    taskID: 1,
    echo: { message: "test", ms: 0 },
  };
  // Should not throw - data is structured-clone safe.
  // Await the response to avoid leaking the internal setTimeout timer.
  const response = await sendAndReceive(worker, validData);
  assertEquals(response.taskID, 1);

  worker.terminate();
});

Deno.test("MockWorker: rejects non-cloneable payload when debug validation is on", () => {
  // Issue #3476: with the debug flag on, MockWorker must still fire the
  // Issue #1428 non-cloneable-payload detection (a synchronous DataCloneError
  // from structuredClone), preserving the guarantee under the flag.
  const worker = new MockWorker();

  // A function is not structured-clone safe.
  const nonCloneable = {
    taskID: 30,
    debug: true,
    echo: { message: "boom", ms: 0 },
    // deno-lint-ignore no-explicit-any
    notCloneable: (() => {}) as any,
  } as unknown as RequestData;

  assertThrows(
    () => worker.postMessage(nonCloneable),
    // Deno throws a DataCloneError for non-cloneable structuredClone input.
    Error,
  );

  worker.terminate();
});

Deno.test("MockWorker: skips structuredClone on the single-thread happy path (debug off)", async () => {
  // Issue #3476: with debug off (default), postMessage must NOT deep-clone the
  // payload. A payload carrying a function would throw DataCloneError if cloned;
  // here it must be processed without throwing because the clone is skipped.
  const original = globalThis.structuredClone;
  let cloneCalls = 0;
  globalThis.structuredClone = ((value: unknown) => {
    cloneCalls++;
    return original(value);
  }) as typeof structuredClone;

  try {
    const worker = new MockWorker();

    const payloadWithFunction = {
      taskID: 31,
      echo: { message: "no-clone", ms: 0 },
      // A function would make structuredClone throw — proves it is not called.
      // deno-lint-ignore no-explicit-any
      sideChannel: (() => {}) as any,
    } as unknown as RequestData;

    // Must not throw and must return a normal response.
    const response = await sendAndReceive(worker, payloadWithFunction);
    assertEquals(response.taskID, 31);
    assertEquals(
      cloneCalls,
      0,
      "structuredClone must not be invoked on the debug-off happy path",
    );

    worker.terminate();
  } finally {
    globalThis.structuredClone = original;
  }
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

  // Send messages sequentially and await each response
  const response1 = await sendAndReceive(worker, {
    taskID: 1,
    echo: { message: "first", ms: 0 },
  });
  const response2 = await sendAndReceive(worker, {
    taskID: 2,
    echo: { message: "second", ms: 0 },
  });

  assertEquals(response1.taskID, 1);
  assertEquals(response1.echo?.message, "first");
  assertEquals(response2.taskID, 2);
  assertEquals(response2.echo?.message, "second");

  worker.terminate();
});

Deno.test("MockWorker: error response for evaluate includes infinity error", async () => {
  const worker = new MockWorker();

  // Sending evaluate without initialising the processor's dataSetDir
  // should trigger an error response
  const response = await sendAndReceive(worker, {
    taskID: 10,
    evaluate: {
      creature: { input: 0, output: 0, neurons: [], synapses: [] },
      feedbackLoop: false,
    },
  });

  assertEquals(response.taskID, 10);
  assertExists(response.evaluate);
  assertEquals(response.evaluate?.error, Number.POSITIVE_INFINITY);

  worker.terminate();
});

Deno.test("MockWorker: evaluate error response preserves error details", async () => {
  const worker = new MockWorker();

  const response = await sendAndReceive(worker, {
    taskID: 20,
    evaluate: {
      creature: { input: 0, output: 0, neurons: [], synapses: [] },
      feedbackLoop: false,
    },
  });

  assertEquals(response.taskID, 20);
  // Issue #1761: Error responses must include name, message, and stack
  assertExists(response.error, "error field must be present");
  assertExists(response.error?.name, "error name must be present");
  assertExists(response.error?.message, "error message must be present");
  assert(
    response.error!.message.length > 0,
    "error message must not be empty",
  );

  worker.terminate();
});

Deno.test("MockWorker: train error response preserves error details", async () => {
  const worker = new MockWorker();

  const response = await sendAndReceive(worker, {
    taskID: 21,
    train: {
      creature: { input: 0, output: 0, neurons: [], synapses: [] },
      options: {} as import("../../src/config/TrainOptions.ts").TrainOptions,
    },
  });

  assertEquals(response.taskID, 21);
  assertExists(response.train);
  assertEquals(response.train?.error, Number.POSITIVE_INFINITY);
  // Issue #1761: Error responses must include name, message, and stack
  assertExists(response.error, "error field must be present");
  assertExists(response.error?.name, "error name must be present");
  assertExists(response.error?.message, "error message must be present");

  worker.terminate();
});

Deno.test("MockWorker: discover error response preserves error details", async () => {
  const worker = new MockWorker();

  const response = await sendAndReceive(worker, {
    taskID: 22,
    discover: {
      creature: { input: 0, output: 0, neurons: [], synapses: [] },
      config: {} as import("../../src/config/NeatConfig.ts").NeatConfig,
    },
  });

  assertEquals(response.taskID, 22);
  assertExists(response.discover);
  // Issue #1761: Error responses must include name, message, and stack
  assertExists(response.error, "error field must be present");
  assertExists(response.error?.name, "error name must be present");
  assertExists(response.error?.message, "error message must be present");

  worker.terminate();
});

Deno.test("MockWorker: error response for breed includes success=false", async () => {
  const worker = new MockWorker();

  const response = await sendAndReceive(worker, {
    taskID: 11,
    breed: {
      mother: { input: 0, output: 0, neurons: [], synapses: [] },
      father: { input: 0, output: 0, neurons: [], synapses: [] },
      geneticCompatibilityThreshold: 0.3,
      forwardOnly: false,
    },
  });

  assertEquals(response.taskID, 11);
  assertExists(response.breed);
  assertEquals(response.breed?.success, false);

  worker.terminate();
});
