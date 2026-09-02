/**
 * WHAT-tests for GRQ #4620 worker discover-error handling.
 *
 * A worker failure resolves as a `ResponseData` carrying `error`, and
 * `buildWorkerErrorResponse` sets `discover: { ID: "error" }` alongside it. The
 * discovery completion path must classify that as a failure — reporting it
 * through `[Neat] Discovery failed for creature …` — instead of recording it as
 * a completed discovery that found nothing.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Creature } from "@creature";
import { buildWorkerErrorResponse } from "@multithreading/workers/WorkerErrorResponse.ts";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";
import type { Neat } from "@neat/Neat.ts";
import {
  attachDiscoveryCompletionHandlers,
  isFailedDiscoverWorkerResponse,
} from "@neat/NeatScheduling.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** A discover request as the main thread sends it to a worker. */
function discoverRequest(): RequestData {
  return {
    taskID: 3,
    discover: {
      creature: { input: 2, output: 1, neurons: [], synapses: [] },
      config: createNeatConfig({}),
    },
  };
}

/** Captures `error`-level log lines emitted while a task settles. */
function captureErrorLogs(): { lines: string[]; restore: () => void } {
  const previous = getLogger();
  const lines: string[] = [];
  const capturing: Logger = {
    debug() {},
    info() {},
    warn() {},
    error(...args: unknown[]) {
      lines.push(args.map((a) => String(a)).join(" "));
    },
  };
  setLogger(capturing);
  return { lines, restore: () => setLogger(previous) };
}

/** Minimal `Neat` stub recording what the completion path pushes. */
function createStubNeat(recorded: ResponseData[]): Neat {
  return {
    config: createNeatConfig({}),
    abandonEpoch: 0,
    lastDiscoveryDurationMS: 0,
    discoveryInProgress: new Map(),
    isRunAbandonedSince: () => false,
    recordDiscoveryComplete: (
      _uuid: string,
      _scheduledEpoch: number,
      result: ResponseData,
    ) => {
      recorded.push(result);
      return true;
    },
  } as unknown as Neat;
}

Deno.test("buildWorkerErrorResponse - discover keeps the real error beside the error stub", () => {
  const response = buildWorkerErrorResponse(
    discoverRequest(),
    new Error("NotFound: No such file or directory (os error 2)"),
    9,
  );

  assertEquals(response.taskID, 3);
  assertExists(response.error);
  assertEquals(response.discover?.ID, "error");
  assert(
    isFailedDiscoverWorkerResponse(response),
    "a worker error response must be classified as a discovery failure",
  );
});

Deno.test("isFailedDiscoverWorkerResponse - error field, missing discover and error stub are failures", () => {
  assertEquals(
    isFailedDiscoverWorkerResponse({
      taskID: 1,
      duration: 0,
      error: { message: "boom" },
      discover: { ID: "error" },
    }),
    true,
  );
  assertEquals(
    isFailedDiscoverWorkerResponse({ taskID: 1, duration: 0 }),
    true,
  );
  assertEquals(
    isFailedDiscoverWorkerResponse({
      taskID: 1,
      duration: 0,
      discover: { ID: "error" },
    }),
    true,
  );
});

Deno.test("isFailedDiscoverWorkerResponse - a real discovery is not a failure", () => {
  assertEquals(
    isFailedDiscoverWorkerResponse({
      taskID: 1,
      duration: 12,
      discover: { ID: "e4d0f1a2", addHelpfulSynapses: [] },
    }),
    false,
  );
});

Deno.test("discovery completion - a worker error response is reported as a failure, not a barren completion", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const recorded: ResponseData[] = [];
  const neat = createStubNeat(recorded);
  const errorResponse = buildWorkerErrorResponse(
    discoverRequest(),
    new Error("NotFound: No such file or directory (os error 2)"),
    9,
  );

  const capture = captureErrorLogs();
  try {
    await attachDiscoveryCompletionHandlers(
      neat,
      creature,
      uuid,
      0,
      Date.now(),
      Promise.resolve(errorResponse),
    );
  } finally {
    capture.restore();
  }

  assertEquals(
    capture.lines.filter((line) =>
      line.includes("[Neat] Discovery failed for creature")
    ).length,
    1,
    "the failure must be reported through the discovery-failed path",
  );
  assertEquals(recorded.length, 1, "the in-flight slot must still be released");
  assertEquals(
    recorded[0].discover?.ID,
    uuid,
    "the worker's error stub must not be recorded as a completed discovery",
  );
  assertEquals(
    recorded[0].discover?.addHelpfulSynapses,
    undefined,
    "a failed discovery must not masquerade as a discovery that found nothing",
  );
});
