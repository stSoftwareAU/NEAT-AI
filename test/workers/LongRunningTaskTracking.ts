/**
 * Tests for long-running task tracking in WorkerHandlerBase.
 *
 * Issue #2161: Validates that isRunningLongTask() correctly tracks
 * long-running operations (discover, train) while remaining false
 * for short-lived operations (evaluate, breed, configureCache, etc.).
 */
import { assertEquals } from "@std/assert";
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import { WorkerHandlerBase } from "@workers/WorkerHandlerBase.ts";

/** Minimal request type for testing. */
interface TestRequest extends BaseRequestData {
  initialize?: { payload: string };
  echo?: { message: string };
}

/** Minimal response type for testing. */
interface TestResponse extends BaseResponseData {
  initialize?: { status: string };
  echo?: { message: string };
}

/**
 * A trivial in-process mock worker for testing.
 */
class TestMockWorker implements WorkerInterface<TestRequest> {
  private callBack: EventListener | null = null;
  public lastPosted: TestRequest | null = null;

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    this.callBack = listener as EventListener;
  }

  postMessage(data: TestRequest): void {
    this.lastPosted = data;
    queueMicrotask(() => {
      const response: TestResponse = {
        taskID: data.taskID,
        duration: 1,
      };
      if (data.initialize) {
        response.initialize = { status: "OK" };
      }
      if (data.echo) {
        response.echo = { message: data.echo.message };
      }
      type MockEvent = Event & { data: TestResponse };
      const me = new Event("message") as MockEvent;
      me.data = response;
      this.callBack?.(me);
    });
  }

  terminate(): void {
    this.callBack = null;
  }
}

/**
 * Concrete subclass exposing long-running task methods for testing.
 */
class TestWorkerHandler extends WorkerHandlerBase<TestRequest, TestResponse> {
  constructor(
    worker: WorkerInterface<TestRequest>,
    initReady: Promise<TestResponse>,
  ) {
    super(worker, initReady);
  }

  /** Simulate a short-lived task (like evaluate or breed). */
  shortTask(data: TestRequest): Promise<TestResponse> {
    return this.makePromiseDeferred(data);
  }

  /** Simulate a long-running task (like discover or train). */
  longTask(data: TestRequest): Promise<TestResponse> {
    this.incrementLongRunningTaskCount();
    return this.makePromiseDeferred(data).finally(() => {
      this.decrementLongRunningTaskCount();
    });
  }

  /** Expose makePromise for testing. */
  sendMessage(data: TestRequest): Promise<TestResponse> {
    return this.makePromise(data);
  }

  /** Expose taskID for testing. */
  getNextTaskID(): number {
    return this.taskID++;
  }
}

/** Helper to create a ready handler. */
function createReadyHandler(): {
  handler: TestWorkerHandler;
  mock: TestMockWorker;
} {
  const mock = new TestMockWorker();
  const handler = new TestWorkerHandler(
    mock,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );
  return { handler, mock };
}

Deno.test("isRunningLongTask: returns false when idle", () => {
  const { handler } = createReadyHandler();
  assertEquals(handler.isRunningLongTask(), false);
  handler.terminate();
});

Deno.test("isRunningLongTask: returns true during a long-running task", async () => {
  const { handler } = createReadyHandler();

  const promise = handler.longTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "discover" },
  });

  // Should be running a long task immediately after calling longTask.
  assertEquals(handler.isRunningLongTask(), true);
  assertEquals(handler.isBusy(), true);

  await promise;

  // Should no longer be running a long task after completion.
  assertEquals(handler.isRunningLongTask(), false);
  assertEquals(handler.isBusy(), false);

  handler.terminate();
});

Deno.test("isRunningLongTask: returns false during short-lived tasks", async () => {
  const { handler } = createReadyHandler();

  const promise = handler.shortTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "evaluate" },
  });

  // Should be busy but NOT running a long task.
  assertEquals(handler.isBusy(), true);
  assertEquals(handler.isRunningLongTask(), false);

  await promise;

  assertEquals(handler.isBusy(), false);
  assertEquals(handler.isRunningLongTask(), false);

  handler.terminate();
});

Deno.test("isRunningLongTask: tracks multiple concurrent long tasks", async () => {
  const { handler } = createReadyHandler();

  const p1 = handler.longTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "discover" },
  });
  const p2 = handler.longTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "train" },
  });

  // Both should be tracked as long-running immediately.
  assertEquals(handler.isRunningLongTask(), true);

  // Wait for both to complete.
  await Promise.all([p1, p2]);
  assertEquals(handler.isRunningLongTask(), false);

  handler.terminate();
});

Deno.test("isRunningLongTask: mixed short and long tasks", async () => {
  const { handler } = createReadyHandler();

  const shortPromise = handler.shortTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "evaluate" },
  });
  const longPromise = handler.longTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "discover" },
  });

  // Both should be busy; long task should be tracked.
  assertEquals(handler.isBusy(), true);
  assertEquals(handler.isRunningLongTask(), true);

  // Wait for both to complete.
  await Promise.all([shortPromise, longPromise]);

  assertEquals(handler.isRunningLongTask(), false);
  assertEquals(handler.isBusy(), false);

  handler.terminate();
});

Deno.test("isRunningLongTask: isBusy behaviour unchanged", async () => {
  const { handler } = createReadyHandler();

  // isBusy should work exactly as before for short tasks.
  assertEquals(handler.isBusy(), false);

  const p = handler.shortTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "breed" },
  });
  assertEquals(handler.isBusy(), true);

  await p;
  assertEquals(handler.isBusy(), false);

  handler.terminate();
});

Deno.test("isRunningLongTask: decrements on init failure (error case)", async () => {
  const mock = new TestMockWorker();

  // Use a deferred promise so the rejection is only triggered after
  // the handler has attached its .then()/.catch() handlers.
  let rejectInit!: (err: Error) => void;
  const initPromise = new Promise<TestResponse>((_resolve, reject) => {
    rejectInit = reject;
  });

  const handler = new TestWorkerHandler(mock, initPromise);

  // Start a long task — increments longRunningTaskCount immediately.
  const longPromise = handler.longTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "discover" },
  });

  assertEquals(handler.isRunningLongTask(), true);

  // Now reject init — the deferred promise should reject and decrement.
  rejectInit(new Error("init failed"));

  let caught = false;
  try {
    await longPromise;
  } catch {
    caught = true;
  }

  assertEquals(caught, true);
  assertEquals(handler.isRunningLongTask(), false);
  assertEquals(handler.isBusy(), false);

  handler.terminate();
});

Deno.test("isRunningLongTask: idle → discover → idle transition", async () => {
  const { handler } = createReadyHandler();

  // Idle state.
  assertEquals(handler.isRunningLongTask(), false);

  // Start discover (long task).
  const discoverPromise = handler.longTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "discover" },
  });
  assertEquals(handler.isRunningLongTask(), true);

  // Complete discover → idle.
  await discoverPromise;
  assertEquals(handler.isRunningLongTask(), false);

  handler.terminate();
});

Deno.test("isRunningLongTask: idle → train → idle transition", async () => {
  const { handler } = createReadyHandler();

  // Idle state.
  assertEquals(handler.isRunningLongTask(), false);

  // Start train (long task).
  const trainPromise = handler.longTask({
    taskID: handler.getNextTaskID(),
    echo: { message: "train" },
  });
  assertEquals(handler.isRunningLongTask(), true);

  // Complete train → idle.
  await trainPromise;
  assertEquals(handler.isRunningLongTask(), false);

  handler.terminate();
});
