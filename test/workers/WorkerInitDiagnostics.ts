/**
 * Issue #3494 — `createInitSequence` diagnostics wiring.
 *
 * `WorkerHandlerBase.createInitSequence` is the single choke point every
 * pooled worker reaches via `waitUntilReady()`. These tests verify that it:
 *
 *   1. emits exactly one compact, greppable `[WasmWorkerInit]` `info` line per
 *      successful init (always on — the diagnostic must exist before the rare
 *      stall recurs); and
 *   2. throws a timeout error whose message carries the parent-observed phase
 *      breakdown, so it lands after the caller's trailing `Error:` token.
 */

import { assert, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import { WorkerHandlerBase } from "@workers/WorkerHandlerBase.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import {
  recordWasmActivationInitDiagnostics,
  resetWasmActivationInitDiagnostics,
  WASM_WORKER_INIT_LOG_PREFIX,
} from "@wasm/WasmInitDiagnostics.ts";

interface TestRequest extends BaseRequestData {
  initialize?: { payload: string };
}
interface TestResponse extends BaseResponseData {
  initialize?: { status: string };
}

/** A mock worker that either answers the init message or never does. */
class MockWorker implements WorkerInterface<TestRequest> {
  private callBack: EventListener | null = null;
  constructor(private readonly respond: boolean) {}

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.callBack = listener as EventListener;
  }

  postMessage(data: TestRequest): void {
    if (!this.respond) return; // simulate a stuck worker
    queueMicrotask(() => {
      const response: TestResponse = {
        taskID: data.taskID,
        duration: 1,
        initialize: { status: "OK" },
      };
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

class Handler extends WorkerHandlerBase<TestRequest, TestResponse> {
  runInit(
    req: TestRequest,
    errP: Promise<never>,
    timeoutMs: number,
    label: string,
  ): Promise<TestResponse> {
    return this.createInitSequence(req, errP, timeoutMs, label);
  }

  setInitError(err: Error): void {
    this.initWorkerError = err;
  }
}

/** Capture `info` output while running `fn`, restoring the logger after. */
async function captureInfo(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = getLogger();
  const capturing: Logger = {
    debug() {},
    info(...args: unknown[]) {
      lines.push(args.map(String).join(" "));
    },
    warn() {},
    error() {},
  };
  setLogger(capturing);
  try {
    await fn();
  } finally {
    setLogger(original);
  }
  return lines;
}

Deno.test("createInitSequence: emits one info line per successful init", async () => {
  resetWasmActivationInitDiagnostics();
  recordWasmActivationInitDiagnostics({
    bundle: {
      outcome: "hit",
      cacheDir: "/tmp/neat-ai/wasm",
      byteLength: 4242,
      elapsedMs: 2,
    },
    glueImportMs: 10,
    instantiateMs: 20,
    totalMs: 32,
  });

  const mock = new MockWorker(true);
  const handler = new Handler(
    mock,
    Promise.resolve({
      taskID: 0,
      duration: 0,
      initialize: { status: "OK" },
    }),
  );

  const lines = await captureInfo(async () => {
    const never = new Promise<never>(() => {});
    const result = await handler.runInit(
      { taskID: 1, initialize: { payload: "x" } },
      never,
      5_000,
      "worker-42",
    );
    assert(result.initialize?.status === "OK");
  });

  const initLines = lines.filter((l) =>
    l.includes(WASM_WORKER_INIT_LOG_PREFIX)
  );
  assert(initLines.length === 1, "exactly one init line per successful init");
  const line = initLines[0];
  assertStringIncludes(line, "worker=worker-42");
  assertStringIncludes(line, "outcome=ok");
  assertStringIncludes(line, "cache=hit");
  assertStringIncludes(line, "bundleBytes=4242");
  assertStringIncludes(line, "glueImportMs=10");
  assertStringIncludes(line, "workerError=none");

  handler.terminate();
  resetWasmActivationInitDiagnostics();
});

Deno.test("createInitSequence: timeout error carries the phase breakdown", async () => {
  resetWasmActivationInitDiagnostics();
  recordWasmActivationInitDiagnostics({
    bundle: {
      outcome: "miss",
      cacheDir: "/tmp/neat-ai/wasm",
      byteLength: 9001,
      elapsedMs: 4,
    },
    glueImportMs: 8,
    instantiateMs: 15,
    totalMs: 27,
  });

  const mock = new MockWorker(false); // never answers the init handshake
  const handler = new Handler(
    mock,
    Promise.resolve({
      taskID: 0,
      duration: 0,
      initialize: { status: "OK" },
    }),
  );
  handler.setInitError(new Error("worker error event"));

  const never = new Promise<never>(() => {});
  const error = await assertRejects(
    () =>
      handler.runInit(
        { taskID: 1, initialize: { payload: "x" } },
        never,
        100,
        "worker-7",
      ),
    Error,
    "no response after",
  );

  assertStringIncludes(error.message, WASM_WORKER_INIT_LOG_PREFIX);
  assertStringIncludes(error.message, "worker=worker-7");
  assertStringIncludes(error.message, "wasm[cache=miss");
  assertStringIncludes(error.message, "bundleBytes=9001");
  assertStringIncludes(error.message, "Child WASM phase timings unknown");
  assertStringIncludes(
    error.message,
    `workerError=${JSON.stringify("worker error event")}`,
  );

  handler.terminate();
  resetWasmActivationInitDiagnostics();
});
