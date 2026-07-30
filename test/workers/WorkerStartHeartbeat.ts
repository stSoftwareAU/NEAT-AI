/**
 * Issue #3771 — a child that misses its init handshake must still say whether
 * it ever started.
 *
 * The #3494 timeout diagnostic names three candidates ("stuck loading WASM,
 * CPU-starved, or OOM") but cannot tell them apart, so a GRQ-23 `team` run
 * with `cache=hit wasmTotalMs=20 workerError=none` and five 60-second stalls
 * left the actual cause unknown. The child now posts a start heartbeat before
 * any init work, and the timeout error reports it:
 *
 *   - `heartbeat=received` — the isolate started, then stalled;
 *   - `heartbeat=none`     — the isolate never reached its entry point.
 *
 * These tests drive the real `createInitSequence` choke point and the real
 * entry-point message loop, asserting on the error text an operator greps.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import { WorkerHandlerBase } from "@workers/WorkerHandlerBase.ts";
import {
  buildWorkerHeartbeatMessage,
  isWorkerHeartbeatMessage,
  WORKER_HEARTBEAT_FIELD,
} from "@workers/WorkerHeartbeat.ts";
import { setupWorkerMessageLoop } from "@workers/workerEntryPoint.ts";
import { resetWasmActivationInitDiagnostics } from "@wasm/WasmInitDiagnostics.ts";

interface TestRequest extends BaseRequestData {
  initialize?: { payload: string };
}
interface TestResponse extends BaseResponseData {
  initialize?: { status: string };
}

/**
 * A worker that never answers the init handshake, optionally emitting the
 * start heartbeat first — the two cases the diagnostic must distinguish.
 */
class StalledWorker implements WorkerInterface<TestRequest> {
  private callBack: EventListener | null = null;
  constructor(private readonly sendHeartbeat: boolean) {}

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.callBack = listener as EventListener;
    if (this.sendHeartbeat) this.emit(buildWorkerHeartbeatMessage("loaded"));
  }

  postMessage(_data: TestRequest): void {
    // Stalled: the init request is never answered.
  }

  terminate(): void {
    this.callBack = null;
  }

  private emit(data: unknown): void {
    type MockEvent = Event & { data: unknown };
    const event = new Event("message") as MockEvent;
    event.data = data;
    this.callBack?.(event);
  }
}

class Handler extends WorkerHandlerBase<TestRequest, TestResponse> {
  runInit(timeoutMs: number, label: string): Promise<TestResponse> {
    return this.createInitSequence(
      { taskID: 1, initialize: { payload: "x" } },
      new Promise<never>(() => {}),
      timeoutMs,
      label,
    );
  }
}

async function timeoutMessage(sendHeartbeat: boolean): Promise<string> {
  resetWasmActivationInitDiagnostics();
  const worker = new StalledWorker(sendHeartbeat);
  const handler = new Handler(
    worker,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );
  const error = await assertRejects(
    () => handler.runInit(50, "worker-26"),
    Error,
    "no response after",
  );
  handler.terminate();
  return error.message;
}

Deno.test("#3771: a child that never started reports heartbeat=none", async () => {
  const message = await timeoutMessage(false);
  assertStringIncludes(message, "heartbeat=none");
  assertStringIncludes(message, "did not reach its entry point");
  assert(
    !message.includes("heartbeat=received"),
    "a missing heartbeat must never read as received",
  );
});

Deno.test("#3771: a child that started then stalled reports heartbeat=received", async () => {
  const message = await timeoutMessage(true);
  assertStringIncludes(message, "heartbeat=received");
  assertStringIncludes(message, "heartbeatMs=");
  assertStringIncludes(message, "then stalled before answering");
});

Deno.test("#3771: the two stall cases produce different diagnostics", async () => {
  const never = await timeoutMessage(false);
  const stalled = await timeoutMessage(true);
  assert(
    never !== stalled,
    "the whole point is that the operator can tell the two apart",
  );
});

Deno.test("#3771: a heartbeat is not routed as a task response", async () => {
  // The task-callback map asserts a callback exists for every message it
  // sees, so an unrouted heartbeat would throw "No callback" and kill init.
  resetWasmActivationInitDiagnostics();
  const worker = new StalledWorker(true);
  const handler = new Handler(
    worker,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );
  const error = await assertRejects(
    () => handler.runInit(50, "worker-1"),
    Error,
  );
  assertStringIncludes(error.message, "no response after");
  handler.terminate();
});

Deno.test("#3771: the entry point announces itself before any init work", () => {
  const posted: unknown[] = [];
  const scope = self as unknown as {
    onmessage: unknown;
    postMessage: (data: unknown) => void;
  };
  const originalOnMessage = scope.onmessage;
  const originalPost = scope.postMessage;
  scope.postMessage = (data: unknown) => posted.push(data);
  try {
    setupWorkerMessageLoop<TestRequest, TestResponse>(
      {
        process: () =>
          Promise.resolve({ taskID: 1, duration: 0 } as TestResponse),
      },
      (data) => ({ taskID: data.taskID, duration: 0 }),
    );
  } finally {
    scope.postMessage = originalPost;
    scope.onmessage = originalOnMessage;
  }

  assertEquals(posted.length, 1, "exactly one heartbeat on start");
  assert(
    isWorkerHeartbeatMessage(posted[0]),
    `first message must be the start heartbeat, got ${
      JSON.stringify(
        posted[0],
      )
    }`,
  );
});

Deno.test("#3771: only well-formed heartbeats are recognised", () => {
  assert(isWorkerHeartbeatMessage(buildWorkerHeartbeatMessage("loaded")));
  assert(!isWorkerHeartbeatMessage({ taskID: 1, duration: 0 }));
  assert(!isWorkerHeartbeatMessage(null));
  assert(!isWorkerHeartbeatMessage("loaded"));
  assert(!isWorkerHeartbeatMessage({ [WORKER_HEARTBEAT_FIELD]: "loaded" }));
  assert(!isWorkerHeartbeatMessage({ [WORKER_HEARTBEAT_FIELD]: {} }));
});
