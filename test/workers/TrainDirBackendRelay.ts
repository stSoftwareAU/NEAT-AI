/**
 * Issue #4146 — the training backend line a pooled worker reports must reach
 * the parent's logger.
 *
 * A worker isolate's own console is invisible to the parent, so a hung native
 * `trainDir` task left no trace of its backend or deadline. The worker now
 * relays each `trainDir` report as a log message, which the parent writes to
 * its logger instead of routing it as a task response.
 *
 * (a) drives a real `Worker` through the real relay installer;
 * (b) pins the wire check: only a well-formed log message is taken;
 * (c) drives the real `WorkerHandlerBase` listener and checks the relayed line
 *     reaches the logger set via `setLogger` and never reaches the task map.
 */

import { assertEquals, assertRejects } from "@std/assert";
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import { WorkerHandlerBase } from "@workers/WorkerHandlerBase.ts";
import { buildWorkerHeartbeatMessage } from "@workers/WorkerHeartbeat.ts";
import {
  buildWorkerLogMessage,
  routeWorkerLogMessage,
  WORKER_LOG_FIELD,
} from "@workers/WorkerLogRelay.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

/** The exact line the parent must write for the task below. */
const EXPECTED_LINE =
  "[training-backend] task=abcd1234 backend=ffi deadlineSent=yes capability=1";

interface Captured {
  level: string;
  message: string;
}

/** A Logger that records every call instead of printing it. */
function capturingLogger(sink: Captured[]): Logger {
  const record = (level: string) => (...args: unknown[]) => {
    sink.push({ level, message: args.map((arg) => String(arg)).join(" ") });
  };
  return {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

// --- (a) a real worker's report reaches the parent's logger -----------------

Deno.test("Issue #4146: a worker's training backend line reaches the parent logger at info level", async () => {
  const srcRoot = new URL("../../src/", import.meta.url).href;
  // The module installs the real relay, then reports through the real
  // reporter, exactly as `worker.ts` and `RustTrainDirBridge` do in production.
  const workerSource = `
import { installTrainDirRelay } from "${srcRoot}multithreading/workers/WorkerTrainDirRelay.ts";
import { reportTrainDirBackend } from "${srcRoot}architecture/training/TrainDirBackendReport.ts";
installTrainDirRelay((m) => self.postMessage(m));
reportTrainDirBackend("abcd1234", { backend: "ffi", deadlineSent: true, capability: "1" });
`;
  const tmpPath = await Deno.makeTempFile({ suffix: ".ts" });
  await Deno.writeTextFile(tmpPath, workerSource);
  const worker = new Worker(new URL(`file://${tmpPath}`).href, {
    type: "module",
  });
  try {
    const data = await new Promise<unknown>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent) => resolve(event.data);
      worker.onerror = (event: Event) => {
        reject(new Error(`Worker error: ${(event as ErrorEvent).message}`));
      };
    });

    const sink: Captured[] = [];
    const routed = routeWorkerLogMessage(data, capturingLogger(sink));

    assertEquals(routed, true, "the relayed report must be taken as a log");
    assertEquals(sink, [{ level: "info", message: EXPECTED_LINE }]);
  } finally {
    worker.terminate();
    await Deno.remove(tmpPath);
  }
});

// --- (b) only a well-formed log message is taken -----------------------------

Deno.test("Issue #4146: routeWorkerLogMessage ignores non-log messages and logs nothing", () => {
  const notLogs: unknown[] = [
    { taskID: 1, duration: 0 },
    null,
    "info",
    buildWorkerHeartbeatMessage("loaded"),
    { [WORKER_LOG_FIELD]: { level: "error", message: "x" } },
    { [WORKER_LOG_FIELD]: { level: "debug", message: "x" } },
    { [WORKER_LOG_FIELD]: { level: "info", message: 42 } },
    { [WORKER_LOG_FIELD]: { level: "info" } },
    { [WORKER_LOG_FIELD]: "info" },
  ];
  for (const data of notLogs) {
    const sink: Captured[] = [];
    assertEquals(
      routeWorkerLogMessage(data, capturingLogger(sink)),
      false,
      `must not be taken as a log: ${JSON.stringify(data)}`,
    );
    assertEquals(sink, [], `must log nothing for: ${JSON.stringify(data)}`);
  }
});

Deno.test("Issue #4146: routeWorkerLogMessage takes a warn line at warn level", () => {
  const sink: Captured[] = [];
  const routed = routeWorkerLogMessage(
    buildWorkerLogMessage("warn", "legacy deadline"),
    capturingLogger(sink),
  );
  assertEquals(routed, true);
  assertEquals(sink, [{ level: "warn", message: "legacy deadline" }]);
});

// --- (c) the parent's listener takes the line off the task path -------------

interface TestRequest extends BaseRequestData {
  initialize?: { payload: string };
}
interface TestResponse extends BaseResponseData {
  initialize?: { status: string };
}

/** A worker whose listener the test drives directly. Never answers init. */
class ScriptedWorker implements WorkerInterface<TestRequest> {
  private callBack: EventListener | null = null;

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.callBack = listener as EventListener;
  }

  postMessage(_data: TestRequest): void {
    // The init request is never answered.
  }

  terminate(): void {
    this.callBack = null;
  }

  emit(data: unknown): void {
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

Deno.test("Issue #4146: a relayed worker log line reaches the parent logger and never the task callbacks", async () => {
  const previous = getLogger();
  const sink: Captured[] = [];
  setLogger(capturingLogger(sink));
  const worker = new ScriptedWorker();
  const handler = new Handler(
    worker,
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );
  try {
    const pending = assertRejects(
      () => handler.runInit(50, "worker-4146"),
      Error,
      "no response after",
    );
    // If the listener routed this to the task-callback map it would throw
    // here, synchronously, and fail the test.
    worker.emit(
      buildWorkerLogMessage(
        "info",
        "[training-backend] task=abcd1234 backend=wasm deadlineSent=no capability=none",
      ),
    );
    await pending;
    assertEquals(sink, [{
      level: "info",
      message:
        "[training-backend] task=abcd1234 backend=wasm deadlineSent=no capability=none",
    }]);
  } finally {
    handler.terminate();
    setLogger(previous);
  }
});
