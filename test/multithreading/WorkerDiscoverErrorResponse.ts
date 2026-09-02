/**
 * WHAT-tests for GRQ #4620 worker discover-error handling.
 *
 * A worker failure resolves as a `ResponseData` carrying `error`, and
 * `buildWorkerErrorResponse` sets `discover: { ID: "error" }` alongside it. The
 * discovery completion path must classify that as a failure — reporting it
 * through `[Neat] Discovery failed for creature …` and accounting for it as a
 * `"failed"` discovery — instead of recording a completed discovery that found
 * nothing.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import type { TrainingEvent } from "@config/TrainingEvent.ts";
import { Creature } from "@creature";
import { buildWorkerErrorResponse } from "@multithreading/workers/WorkerErrorResponse.ts";
import type {
  RequestData,
  ResponseData,
} from "@multithreading/workers/WorkerHandler.ts";
import { Neat } from "@neat/Neat.ts";
import {
  attachDiscoveryCompletionHandlers,
  isFailedDiscoverWorkerResponse,
} from "@neat/NeatScheduling.ts";
import { processCompletedResults } from "@neat/ProcessCompletedResults.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** The message the worker failure carries end to end. */
const WORKER_FAILURE_MESSAGE =
  "NotFound: No such file or directory (os error 2)";

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

/** The response a worker returns when the discover task throws. */
function workerErrorResponse(): ResponseData {
  return buildWorkerErrorResponse(
    discoverRequest(),
    new Error(WORKER_FAILURE_MESSAGE),
    9,
  );
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

/**
 * Minimal `Neat` stub that uses the real `recordDiscoveryComplete`, so the
 * in-flight guard and the complete queue behave exactly as they do in a run.
 */
function createStubNeat(uuid: string): Neat {
  return {
    config: createNeatConfig({}),
    abandonEpoch: 0,
    lastDiscoveryDurationMS: 0,
    discoveryInProgress: new Map([[uuid, Promise.resolve()]]),
    discoveryComplete: [] as ResponseData[],
    isRunAbandonedSince: Neat.prototype.isRunAbandonedSince,
    recordDiscoveryComplete: Neat.prototype.recordDiscoveryComplete,
  } as unknown as Neat;
}

Deno.test("buildWorkerErrorResponse - discover keeps the real error beside the error stub", () => {
  const response = workerErrorResponse();

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
  const neat = createStubNeat(uuid);
  // Built before the capture is installed: `createNeatConfig` installs its own
  // logger, which would replace the capturing one.
  const response = Promise.resolve(workerErrorResponse());

  const capture = captureErrorLogs();
  try {
    await attachDiscoveryCompletionHandlers(
      neat,
      creature,
      uuid,
      0,
      0,
      response,
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
  assertEquals(
    neat.discoveryInProgress.has(uuid),
    false,
    "the in-flight discovery slot must be released",
  );
  assertEquals(neat.discoveryComplete.length, 1);
  assertEquals(
    neat.discoveryComplete[0].error?.message,
    WORKER_FAILURE_MESSAGE,
    "the recorded result must carry the failure, not look like a completion",
  );
  assertEquals(
    neat.discoveryComplete[0].discover?.ID,
    uuid,
    "the worker's `error` ID stub must not be recorded as a discovery",
  );
});

Deno.test("discovery completion - a healthy response is still recorded as a completion", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const neat = createStubNeat(uuid);

  await attachDiscoveryCompletionHandlers(
    neat,
    creature,
    uuid,
    0,
    0,
    Promise.resolve({
      taskID: 4,
      duration: 20,
      discover: { ID: uuid, addHelpfulSynapses: [] },
    }),
  );

  assertEquals(neat.discoveryInProgress.has(uuid), false);
  assertEquals(neat.discoveryComplete.length, 1);
  assertEquals(
    neat.discoveryComplete[0].error,
    undefined,
    "a genuine discovery must not be marked as failed",
  );
});

Deno.test("a worker discover failure is reported end to end as a `failed` discovery that cost real time", async () => {
  await initWasmForTests();
  const fittest = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(fittest);
  const events: TrainingEvent[] = [];

  // The two halves must meet: the entry `processCompletedResults` reports on is
  // the one the completion handler actually recorded, not a hand-built stand-in.
  const settling = createStubNeat(uuid);
  // A task dispatched this far in the past: `Date.now()` only moves forward, so
  // the recorded duration is at least this, with nothing timing-dependent.
  const elapsedFloorMS = 1_234;
  await attachDiscoveryCompletionHandlers(
    settling,
    fittest,
    uuid,
    0,
    Date.now() - elapsedFloorMS,
    Promise.resolve(workerErrorResponse()),
  );
  assertEquals(settling.discoveryComplete.length, 1);

  const neat = {
    config: createNeatConfig({
      onTrainingEvent: (event: TrainingEvent) => events.push(event),
    }),
    trainingComplete: [] as ResponseData[],
    discoveryComplete: settling.discoveryComplete,
    discoveryReplayQueue: {
      getCompletedResults: () => [],
      clearCompletedResults: () => {},
    },
  } as unknown as Neat;

  const added = processCompletedResults(
    neat,
    fittest,
    undefined as unknown as Parameters<typeof processCompletedResults>[2],
  );

  assertEquals(added.length, 0, "a failed discovery adds no creature");
  const discoveryEvents = events.filter((e) =>
    e.kind === "discovery_complete"
  ) as Extract<TrainingEvent, { kind: "discovery_complete" }>[];
  assertEquals(discoveryEvents.length, 1);
  assertEquals(
    discoveryEvents[0].outcome,
    "failed",
    "a failed discovery must not be counted as a run that found nothing",
  );
  assert(
    discoveryEvents[0].elapsedMs >= elapsedFloorMS,
    `the loss must be counted with the time it cost, got elapsedMs=${
      discoveryEvents[0].elapsedMs
    }`,
  );
});

Deno.test("a discover response with no payload at all is reported as a typed discovery failure", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1);
  const uuid = CreatureUtil.makeUUID(creature);
  const neat = createStubNeat(uuid);

  await attachDiscoveryCompletionHandlers(
    neat,
    creature,
    uuid,
    0,
    Date.now(),
    // No `error` and no `discover`: the worker gave nothing usable back.
    Promise.resolve({ taskID: 7, duration: 5 }),
  );

  assertEquals(neat.discoveryComplete.length, 1);
  assertEquals(
    neat.discoveryComplete[0].error?.name,
    "DiscoveryError",
    "a synthesised cause must be a typed discovery error, not a bare Error",
  );
  assertExists(neat.discoveryComplete[0].error?.message);
});
