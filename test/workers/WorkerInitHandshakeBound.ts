/**
 * GRQ #4238 — the parent-observed handshake counter must measure the handshake.
 *
 * A GRQ-13 `team` run reported
 * `[WasmWorkerInit] Worker init: no response after 60s … handshakeMs=895250`:
 * 14m 55s of "handshake" against a 60s deadline. The counter was a raw
 * `performance.now()` delta read inside the timeout callback, so whenever the
 * parent's own event loop was blocked the timer fired late and the overshoot
 * was billed to the child. The number that was supposed to diagnose the stall
 * pointed at the wrong process — which is why GRQ #3771 came back.
 *
 * These tests drive the real `createInitSequence` choke point with a worker
 * that never answers, and assert:
 *
 *   - `handshakeMs` never exceeds the configured timeout;
 *   - the overshoot is reported as `parentStallMs`, attributed to the parent;
 *   - a parent event loop blocked *inside* the handshake window is measured
 *     (`loopBlockedMs`) rather than guessed, so a missing child heartbeat is
 *     not read as "the child never started" when the parent was not looking.
 */

import { assert, assertRejects } from "@std/assert";
import type {
  BaseRequestData,
  BaseResponseData,
  WorkerInterface,
} from "@workers/WorkerInterface.ts";
import { WorkerHandlerBase } from "@workers/WorkerHandlerBase.ts";
import { resetWasmActivationInitDiagnostics } from "@wasm/WasmInitDiagnostics.ts";

interface TestRequest extends BaseRequestData {
  initialize?: { payload: string };
}
interface TestResponse extends BaseResponseData {
  initialize?: { status: string };
}

/** A worker that accepts the init request and never answers it. */
class SilentWorker implements WorkerInterface<TestRequest> {
  private callBack: EventListener | null = null;

  addEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.callBack = listener as EventListener;
  }

  postMessage(_data: TestRequest): void {
    // Never answers — the stall this issue is about.
  }

  terminate(): void {
    this.callBack = null;
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

/** Numeric value of `field=<n>` in the diagnostic, or undefined when absent. */
function field(message: string, name: string): number | undefined {
  const m = message.match(new RegExp(`${name}=(-?\\d+)`));
  return m ? Number(m[1]) : undefined;
}

/**
 * Run the init handshake against a silent worker, optionally blocking the
 * parent's event loop for `blockMs` so the timeout callback fires late — the
 * GRQ-13 shape.
 */
async function timeoutMessage(
  timeoutMs: number,
  blockMs = 0,
): Promise<string> {
  resetWasmActivationInitDiagnostics();
  const handler = new Handler(
    new SilentWorker(),
    Promise.resolve({ taskID: 0, duration: 0, initialize: { status: "OK" } }),
  );
  const pending = assertRejects(
    () => handler.runInit(timeoutMs, "worker-114"),
    Error,
    "no response after",
  );
  if (blockMs > 0) {
    // Synchronous spin: the only faithful reproduction of a blocked parent.
    const until = performance.now() + blockMs;
    while (performance.now() < until) {
      // Busy-wait; nothing on the loop can run, including the init timer.
    }
  }
  const error = await pending;
  handler.terminate();
  return error.message;
}

Deno.test("GRQ #4238: handshakeMs is bounded by the configured timeout", async () => {
  const timeoutMs = 200;
  const message = await timeoutMessage(timeoutMs, 800);

  const handshakeMs = field(message, "handshakeMs");
  assert(handshakeMs !== undefined, `no handshakeMs field in: ${message}`);
  assert(
    handshakeMs <= timeoutMs,
    `handshakeMs=${handshakeMs} exceeds the ${timeoutMs}ms timeout: ${message}`,
  );
  assert(handshakeMs >= 0, `handshakeMs=${handshakeMs} must not be negative`);
});

Deno.test("GRQ #4238: the deadline overshoot is reported as a parent-side stall", async () => {
  const message = await timeoutMessage(200, 800);

  const parentStallMs = field(message, "parentStallMs");
  assert(parentStallMs !== undefined, `no parentStallMs field in: ${message}`);
  assert(
    parentStallMs >= 250,
    `a parent blocked for 800ms must report it, got ${parentStallMs}`,
  );
  assert(
    message.includes("parent"),
    `the verdict must name the parent as the stalled side: ${message}`,
  );
});

Deno.test("GRQ #4238: a blocked parent is not reported as a child that never started", async () => {
  const message = await timeoutMessage(200, 800);

  assert(
    !message.includes("did not reach its entry point"),
    `heartbeat=none is not evidence while the parent is blocked: ${message}`,
  );
  const loopBlockedMs = field(message, "loopBlockedMs");
  assert(loopBlockedMs !== undefined, `no loopBlockedMs field in: ${message}`);
});

Deno.test("GRQ #4238: a responsive parent still reports a bounded handshake and no stall", async () => {
  const timeoutMs = 200;
  const message = await timeoutMessage(timeoutMs);

  const handshakeMs = field(message, "handshakeMs");
  assert(handshakeMs !== undefined && handshakeMs <= timeoutMs, message);
  const parentStallMs = field(message, "parentStallMs");
  assert(
    parentStallMs !== undefined && parentStallMs < 250,
    `a responsive parent must not report a stall, got ${parentStallMs}`,
  );
  // With the parent responsive throughout, the missing heartbeat is a real
  // signal about the child.
  assert(
    message.includes("did not reach its entry point"),
    `a responsive parent must attribute the silence to the child: ${message}`,
  );
});
