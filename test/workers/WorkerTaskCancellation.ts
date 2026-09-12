/**
 * Tests for cancelling a worker task whose response never arrives (GRQ #4489).
 *
 * Before this, a request posted to a worker that never answered left its
 * promise pending forever: `WorkerHandlerBase` held the callback, nothing
 * bounded the wait, and the only trace on the GRQ fleet was NEAT's stuck-task
 * watchdog forgetting the bookkeeping while the work itself stayed in flight.
 * Seven of 27 hosts returned `scheduled=N completed=0` on 2026-08-28 that way.
 *
 * The behaviour asserted here is the settlement contract:
 *   - an in-flight task can be cancelled and settles as a loud, attributed
 *     failure naming the task, the worker and how long it ran;
 *   - a response that arrives after the cancellation is dropped quietly
 *     instead of throwing out of the worker's message listener;
 *   - a worker-level `error` event *after* init fails every in-flight task on
 *     that worker rather than being logged and forgotten;
 *   - a quarantined worker is reported unhealthy and terminated so no further
 *     work is handed to a wedged isolate.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import {
  notifyWorkerError,
  WorkerHandlerBase,
} from "@workers/WorkerHandlerBase.ts";
import { WorkerTaskCancelledError } from "@workers/WorkerTaskCancelledError.ts";

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
 * A worker that answers `initialize` immediately and then goes silent — the
 * shape of a wedged isolate: the request is accepted, no response ever comes.
 */
class SilentWorker implements WorkerInterface<TestRequest> {
  private callBack: EventListener | null = null;
  public posted: TestRequest[] = [];
  public terminated = false;

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    this.callBack = listener as EventListener;
  }

  postMessage(data: TestRequest): void {
    this.posted.push(data);
    if (data.initialize) {
      this.respond(data.taskID, { initialize: { status: "OK" } });
    }
  }

  /** Deliver a response for `taskID`, as a real worker would. */
  respond(taskID: number, extra: Partial<TestResponse> = {}): void {
    const response: TestResponse = { taskID, duration: 1, ...extra };
    type MockEvent = Event & { data: TestResponse };
    const me = new Event("message") as MockEvent;
    me.data = response;
    this.callBack?.(me);
  }

  terminate(): void {
    this.terminated = true;
    this.callBack = null;
  }
}

/** Concrete handler exposing the deferred send used by real jobs. */
class TestWorkerHandler extends WorkerHandlerBase<TestRequest, TestResponse> {
  constructor(
    worker: WorkerInterface<TestRequest>,
    initReady: Promise<TestResponse>,
  ) {
    super(worker, initReady);
  }

  /** Post a job the way `train`/`discover` do, returning its task id. */
  sendTracked(
    message: string,
  ): { taskID: number; response: Promise<TestResponse> } {
    const data: TestRequest = {
      taskID: this.taskID++,
      echo: { message },
    };
    return { taskID: data.taskID, response: this.makePromiseDeferred(data) };
  }
}

function createHandler(): { worker: SilentWorker; handler: TestWorkerHandler } {
  const worker = new SilentWorker();
  const initReady = Promise.resolve<TestResponse>({
    taskID: 0,
    duration: 0,
    initialize: { status: "OK" },
  });
  return { worker, handler: new TestWorkerHandler(worker, initReady) };
}

Deno.test("cancelTask settles a task the worker never answers (GRQ #4489)", async () => {
  const { handler } = createHandler();
  const { taskID, response } = handler.sendTracked("never-answered");

  // Let the deferred post reach the worker.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(handler.isBusy(), "the task is in flight before cancellation");
  assertEquals(handler.getPendingTaskCount(), 1);

  const cancelled = handler.cancelTask(taskID, "past its per-task deadline");
  assert(cancelled, "an in-flight task is cancellable");

  const error = await assertRejects(
    () => response,
    WorkerTaskCancelledError,
  );
  assertEquals(error.taskID, taskID);
  assert(
    error.message.includes("past its per-task deadline"),
    `the reason is reported: ${error.message}`,
  );
  assert(
    error.elapsedMs >= 0,
    "the failure carries how long the task ran before it was cancelled",
  );
  assertEquals(handler.getPendingTaskCount(), 0);
  assertEquals(handler.isBusy(), false, "the worker slot is released");
});

Deno.test("cancelTask reports false for a task that is not in flight (GRQ #4489)", async () => {
  const { handler } = createHandler();
  const { taskID, response } = handler.sendTracked("answered");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(handler.cancelTask(taskID, "first cancel"));
  await assertRejects(() => response, WorkerTaskCancelledError);

  assertEquals(
    handler.cancelTask(taskID, "second cancel"),
    false,
    "a task that already settled cannot be cancelled again",
  );
  assertEquals(handler.cancelTask(9999, "unknown task"), false);
});

Deno.test("a response arriving after cancellation is dropped, not thrown (GRQ #4489)", async () => {
  const { worker, handler } = createHandler();
  const { taskID, response } = handler.sendTracked("late");
  await new Promise((resolve) => setTimeout(resolve, 0));

  handler.cancelTask(taskID, "past its per-task deadline");
  await assertRejects(() => response, WorkerTaskCancelledError);

  // The wedged worker finally answers. Nothing may throw out of the message
  // listener — an uncaught error there kills the whole run.
  worker.respond(taskID, { echo: { message: "late" } });

  assertEquals(handler.getPendingTaskCount(), 0);
  assertEquals(handler.isBusy(), false);
});

Deno.test("a worker error after init fails every in-flight task (GRQ #4489)", async () => {
  const { worker, handler } = createHandler();
  const first = handler.sendTracked("a");
  const second = handler.sendTracked("b");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(handler.getPendingTaskCount(), 2);

  const crash = new Error("Worker error event (worker-1) | message=boom");
  notifyWorkerError(worker, crash);

  const firstError = await assertRejects(
    () => first.response,
    WorkerTaskCancelledError,
  );
  const secondError = await assertRejects(
    () => second.response,
    WorkerTaskCancelledError,
  );
  assertEquals(firstError.cause, crash, "the crash is carried as the cause");
  assertEquals(secondError.cause, crash);

  assertEquals(handler.isHealthy(), false, "a crashed worker is unhealthy");
  assert(worker.terminated, "a crashed worker is terminated, not left wedged");
  assertEquals(handler.getPendingTaskCount(), 0);
});

Deno.test("quarantine cancels in-flight work and stops the worker (GRQ #4489)", async () => {
  const { worker, handler } = createHandler();
  const { response } = handler.sendTracked("wedged");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(handler.isHealthy(), "a fresh handler is healthy");
  handler.quarantine("its training task never returned");

  await assertRejects(() => response, WorkerTaskCancelledError);
  assertEquals(handler.isHealthy(), false);
  assert(worker.terminated);
  assertEquals(handler.isBusy(), false);
});
