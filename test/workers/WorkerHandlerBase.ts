/**
 * Tests for the shared WorkerHandlerBase class.
 *
 * Issue #1600: Validates that the extracted base class correctly manages
 * task lifecycle, busy state, idle listeners, and deferred promises.
 */
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
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
 * A trivial in-process mock worker for testing the base class.
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
    // Simulate async processing.
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
 * Concrete subclass for testing.
 */
class TestWorkerHandler extends WorkerHandlerBase<TestRequest, TestResponse> {
  constructor(
    worker: WorkerInterface<TestRequest>,
    initReady: Promise<TestResponse>,
  ) {
    super(worker, initReady);
  }

  /** Expose makePromise for testing. */
  sendMessage(data: TestRequest): Promise<TestResponse> {
    return this.makePromise(data);
  }

  /** Expose makePromiseDeferred for testing. */
  sendMessageDeferred(data: TestRequest): Promise<TestResponse> {
    return this.makePromiseDeferred(data);
  }

  /** Expose taskID for testing. */
  getNextTaskID(): number {
    return this.taskID++;
  }
}

Deno.test("WorkerHandlerBase: starts not busy", () => {
  const mock = new TestMockWorker();
  const handler = new TestWorkerHandler(
    mock,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );
  assertEquals(handler.isBusy(), false);
  handler.terminate();
});

Deno.test("WorkerHandlerBase: makePromise increments busyCount and resolves", async () => {
  const mock = new TestMockWorker();
  const handler = new TestWorkerHandler(
    mock,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );

  const promise = handler.sendMessage({
    taskID: handler.getNextTaskID(),
    echo: { message: "hello" },
  });

  // Should be busy while waiting.
  assertEquals(handler.isBusy(), true);

  const result = await promise;

  // Should resolve with the echo response.
  assertEquals(result.echo?.message, "hello");
  // Should no longer be busy.
  assertEquals(handler.isBusy(), false);

  handler.terminate();
});

Deno.test("WorkerHandlerBase: idle listener fires when work completes", async () => {
  const mock = new TestMockWorker();
  const handler = new TestWorkerHandler(
    mock,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );

  let idleFired = false;
  handler.addIdleListener(() => {
    idleFired = true;
  });

  const promise = handler.sendMessage({
    taskID: handler.getNextTaskID(),
    echo: { message: "test" },
  });

  assertEquals(idleFired, false);
  await promise;
  assertEquals(idleFired, true);

  handler.terminate();
});

Deno.test("WorkerHandlerBase: makePromiseDeferred waits for ready", async () => {
  const mock = new TestMockWorker();

  // Create a deferred init promise.
  let resolveInit!: (v: TestResponse) => void;
  const initPromise = new Promise<TestResponse>((resolve) => {
    resolveInit = resolve;
  });

  const handler = new TestWorkerHandler(mock, initPromise);

  const deferredPromise = handler.sendMessageDeferred({
    taskID: handler.getNextTaskID(),
    echo: { message: "deferred" },
  });

  // Should be busy immediately (busyCount tracks deferred work).
  assertEquals(handler.isBusy(), true);
  // Mock should not have received the message yet.
  assertEquals(mock.lastPosted, null);

  // Resolve init - should then post the message.
  resolveInit({ taskID: 0, duration: 0, initialize: { status: "OK" } });

  const result = await deferredPromise;
  assertEquals(result.echo?.message, "deferred");
  assertEquals(handler.isBusy(), false);

  handler.terminate();
});

Deno.test("WorkerHandlerBase: makePromiseDeferred rejects when init fails", async () => {
  const mock = new TestMockWorker();

  const handler = new TestWorkerHandler(
    mock,
    Promise.reject(new Error("init failed")),
  );

  await assertRejects(
    () =>
      handler.sendMessageDeferred({
        taskID: handler.getNextTaskID(),
        echo: { message: "should fail" },
      }),
    Error,
    "init failed",
  );

  // Should not be busy after rejection.
  assertEquals(handler.isBusy(), false);

  handler.terminate();
});

Deno.test("WorkerHandlerBase: terminate cleans up resources", () => {
  const mock = new TestMockWorker();
  const handler = new TestWorkerHandler(
    mock,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );

  let idleFired = false;
  handler.addIdleListener(() => {
    idleFired = true;
  });

  handler.terminate();

  // After termination, the idle listener should be cleared.
  // We verify by checking isBusy is still false (no crash).
  assertStrictEquals(handler.isBusy(), false);
  assertEquals(idleFired, false);
});

Deno.test("WorkerHandlerBase: multiple concurrent tasks track busyCount", async () => {
  const mock = new TestMockWorker();
  const handler = new TestWorkerHandler(
    mock,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );

  const p1 = handler.sendMessage({
    taskID: handler.getNextTaskID(),
    echo: { message: "one" },
  });
  const p2 = handler.sendMessage({
    taskID: handler.getNextTaskID(),
    echo: { message: "two" },
  });

  assertEquals(handler.isBusy(), true);

  // Wait for both.
  const [r1, r2] = await Promise.all([p1, p2]);
  assertEquals(r1.echo?.message, "one");
  assertEquals(r2.echo?.message, "two");
  assertEquals(handler.isBusy(), false);

  handler.terminate();
});

Deno.test("WorkerHandlerBase: waitUntilReady resolves after init", async () => {
  const mock = new TestMockWorker();
  let resolveInit!: (v: TestResponse) => void;
  const initPromise = new Promise<TestResponse>((resolve) => {
    resolveInit = resolve;
  });

  const handler = new TestWorkerHandler(mock, initPromise);

  let readyResolved = false;
  const readyPromise = handler.waitUntilReady().then(() => {
    readyResolved = true;
  });

  assertEquals(readyResolved, false);

  resolveInit({ taskID: 0, duration: 0, initialize: { status: "OK" } });
  await readyPromise;

  assertEquals(readyResolved, true);

  handler.terminate();
});
