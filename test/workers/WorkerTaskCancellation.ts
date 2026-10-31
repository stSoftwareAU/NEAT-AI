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
 *     work is handed to a wedged isolate;
 *   - a quarantine names each labelled task it fails as collateral of that
 *     quarantine, so no task is reported with another task's reason (Issue
 *     #4095).
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
import { runBoundedEvolveTeardown } from "@creature/BoundedEvolveTeardown.ts";

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

  /**
   * Post a job the way `train`/`discover` do, returning its task id. An
   * optional `label` is the caller's identity for the task (Issue #4095).
   */
  sendTracked(
    message: string,
    label?: string,
  ): { taskID: number; response: Promise<TestResponse> } {
    const data: TestRequest = {
      taskID: this.taskID++,
      echo: { message },
    };
    return {
      taskID: data.taskID,
      response: this.makePromiseDeferred(data, undefined, label),
    };
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

/** Creature uuids used as task labels; none is a substring of another. */
const LABEL_A = "5f1c2a3b-0000-4000-8000-00000000000a";
const LABEL_B = "5f1c2a3b-0000-4000-8000-00000000000b";
const LABEL_C = "5f1c2a3b-0000-4000-8000-00000000000c";

Deno.test("quarantine names each labelled task as its own collateral, not the first task's reason (Issue #4095)", async () => {
  const { handler } = createHandler();
  const labels = [LABEL_A, LABEL_B, LABEL_C];
  const tasks = labels.map((label, i) =>
    handler.sendTracked(`task-${i}`, label)
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(handler.getPendingTaskCount(), 3);

  const reason = "training task AAA passed its per-task deadline";
  handler.quarantine(reason);

  const errors = await Promise.all(
    tasks.map((task) =>
      assertRejects(() => task.response, WorkerTaskCancelledError)
    ),
  );

  for (const [i, error] of errors.entries()) {
    assertEquals(error.taskID, tasks[i].taskID);
    assert(
      error.reason.includes(labels[i]),
      `the failure names its own task ${labels[i]}: ${error.reason}`,
    );
    for (const other of labels) {
      if (other === labels[i]) continue;
      assert(
        !error.reason.includes(other),
        `the failure does not name another task ${other}: ${error.reason}`,
      );
    }
    assert(
      error.reason.includes("quarantined"),
      `the failure says it was quarantined: ${error.reason}`,
    );
    assert(
      error.reason.includes(reason),
      `the failure keeps the quarantine reason: ${error.reason}`,
    );
  }
  assertEquals(handler.getPendingTaskCount(), 0);
});

Deno.test("quarantine keeps the reason unchanged for an unlabelled task (Issue #4095)", async () => {
  const { handler } = createHandler();
  const { response } = handler.sendTracked("unlabelled");
  await new Promise((resolve) => setTimeout(resolve, 0));

  handler.quarantine("its worker crashed");

  const error = await assertRejects(() => response, WorkerTaskCancelledError);
  assertEquals(error.reason, "its worker crashed");
});

Deno.test("couldNotBeStopped is false on a fresh handler (Issue #4126)", () => {
  const { handler } = createHandler();
  assertEquals(handler.couldNotBeStopped(), false);
});

Deno.test("couldNotBeStopped stays false when a quarantine has no unanswered task (Issue #4126)", () => {
  const { worker, handler } = createHandler();

  // An error event on an idle worker: nothing is in flight to be stranded.
  notifyWorkerError(worker, new Error("Worker error event (worker-1)"));

  assertEquals(handler.isHealthy(), false, "the worker was quarantined");
  assertEquals(handler.couldNotBeStopped(), false);
});

Deno.test("couldNotBeStopped is true when a quarantine cancels an unanswered task (Issue #4126)", async () => {
  const { handler } = createHandler();
  const { response } = handler.sendTracked("wedged");
  await new Promise((resolve) => setTimeout(resolve, 0));

  handler.quarantine("its task never returned");

  await assertRejects(() => response, WorkerTaskCancelledError);
  assertEquals(handler.couldNotBeStopped(), true);
});

Deno.test("couldNotBeStopped is true when the culprit task was cancelled before the quarantine (Issue #4126)", async () => {
  const { handler } = createHandler();
  const { taskID, response } = handler.sendTracked("wedged");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(handler.cancelTask(taskID, "past its per-task deadline"));
  await assertRejects(() => response, WorkerTaskCancelledError);
  assertEquals(handler.getPendingTaskCount(), 0);

  handler.quarantine("its worker is wedged");

  assertEquals(
    handler.couldNotBeStopped(),
    true,
    "the unanswered task was cancelled, so its thread may still be blocked",
  );
});

Deno.test("couldNotBeStopped is false when a cancelled task was answered late and a later quarantine is unrelated (Issue #4126)", async () => {
  const { worker, handler } = createHandler();
  const { taskID, response } = handler.sendTracked("late");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(handler.cancelTask(taskID, "past its per-task deadline"));
  await assertRejects(() => response, WorkerTaskCancelledError);

  // The worker finally answers the cancelled task, so its thread is free.
  worker.respond(taskID, { echo: { message: "late" } });

  // Later, an unrelated error event on the now-idle worker quarantines it.
  notifyWorkerError(worker, new Error("Worker error event (worker-1)"));

  assertEquals(handler.isHealthy(), false, "the worker was quarantined");
  assertEquals(
    handler.couldNotBeStopped(),
    false,
    "the cancelled task was answered late, so no thread is left blocked",
  );
});

Deno.test("couldNotBeStopped is false for a cancelled task while the worker is still in service (Issue #4126)", async () => {
  const { handler } = createHandler();
  const { taskID, response } = handler.sendTracked("wedged");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(handler.cancelTask(taskID, "past its per-task deadline"));
  await assertRejects(() => response, WorkerTaskCancelledError);

  assertEquals(handler.isHealthy(), true);
  assertEquals(
    handler.couldNotBeStopped(),
    false,
    "a worker still in service has not been stopped, so nothing is stranded",
  );
});

Deno.test("couldNotBeStopped is true when a task was cancelled without a quarantine and the worker is then terminated (Issue #4126)", async () => {
  const { worker, handler } = createHandler();
  const { taskID, response } = handler.sendTracked("wedged");
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The run's deadline sheds the task; no quarantine follows.
  assert(handler.cancelTask(taskID, "the run's deadline passed"));
  await assertRejects(() => response, WorkerTaskCancelledError);
  assertEquals(handler.isHealthy(), true, "no quarantine happened");

  handler.terminate();

  assert(worker.terminated, "the worker was asked to stop");
  assertEquals(
    handler.couldNotBeStopped(),
    true,
    "the cancelled task never answered, so its thread may still be blocked",
  );
});

Deno.test("couldNotBeStopped is false when the worker is terminated after the cancelled task was answered late (Issue #4126)", async () => {
  const { worker, handler } = createHandler();
  const { taskID, response } = handler.sendTracked("late");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert(handler.cancelTask(taskID, "the run's deadline passed"));
  await assertRejects(() => response, WorkerTaskCancelledError);
  worker.respond(taskID, { echo: { message: "late" } });

  handler.terminate();

  assertEquals(handler.couldNotBeStopped(), false);
});

Deno.test("teardown reports a worker whose task was cancelled at the deadline, with no quarantine (Issue #4126)", async () => {
  const { handler } = createHandler();
  const { taskID, response } = handler.sendTracked("wedged");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(handler.cancelTask(taskID, "the run's deadline passed"));
  await assertRejects(() => response, WorkerTaskCancelledError);
  assertEquals(handler.isHealthy(), true, "no quarantine happened");

  const report = await runBoundedEvolveTeardown({
    label: "test",
    persist: () => Promise.resolve(),
    workers: [handler],
    replayQueue: {
      waitForCompletion: () => Promise.resolve(),
      isReplayInProgress: () => false,
    },
    hardDeadlineMS: 0,
    now: () => 1_000,
    neat: {
      abandonInFlightAtTeardown: () => 0,
      discardUnprocessedResults: () => 0,
    },
  });

  assertEquals(report.workersTerminated, 1);
  assertEquals(
    report.workersUnreclaimable,
    1,
    "the cancelled task never answered, so teardown must report the worker",
  );
});

Deno.test("teardown reports an unanswered task terminated without cancellation (Issue #4126)", async () => {
  const { handler } = createHandler();
  handler.sendTracked("wedged");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const report = await runBoundedEvolveTeardown({
    label: "test",
    persist: () => Promise.resolve(),
    workers: [handler],
    replayQueue: {
      waitForCompletion: () => Promise.resolve(),
      isReplayInProgress: () => false,
    },
    hardDeadlineMS: 0,
    neat: {
      abandonInFlightAtTeardown: () => 0,
      discardUnprocessedResults: () => 0,
    },
  });
  assertEquals(handler.couldNotBeStopped(), true);
  assertEquals(report.workersUnreclaimable, 1);
});
