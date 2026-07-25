import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * Unit tests for Issue #3435 — discard late completions after abandon.
 *
 * When discovery/training work is abandoned past the hard deadline, a
 * late-resolving worker promise must not push its (potentially large) result
 * payload back into `discoveryComplete` / `trainingComplete` and re-inflate the
 * heap after the run has deliberately shed the work. The guarded record methods
 * capture an abandon token at schedule time and discard on mismatch.
 *
 * Assertions are behavioural (queue contents + return value), never elapsed-time
 * measurements (#2888).
 */

function createTestDataDir(input: number, output: number): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      input: new Float32Array(
        Array.from({ length: input }, () => Math.random()),
      ),
      output: new Float32Array(
        Array.from({ length: output }, () => Math.random()),
      ),
    });
  }
  return makeDataDir(records, 2000);
}

function createTestWorkers(dataDir: string): WorkerHandler[] {
  return [new WorkerHandler(dataDir, "MSE", true)];
}

async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
}

function fakeDiscoveryResult(uuid: string): ResponseData {
  return { taskID: 1, duration: 0, discover: { ID: uuid } };
}

function fakeTrainingResult(uuid: string): ResponseData {
  return {
    taskID: 1,
    duration: 0,
    train: {
      ID: uuid,
      creature: { neurons: [], synapses: [], input: 2, output: 1 },
      error: 0.1,
      trace: { neurons: [], synapses: [], input: 2, output: 1 },
    },
  };
}

Deno.test("recordDiscoveryComplete: records a completion for a live task", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const uuid = "disc-live";
    const epoch = neat.abandonEpoch;
    neat.discoveryInProgress.set(uuid, Promise.resolve());

    const recorded = neat.recordDiscoveryComplete(
      uuid,
      epoch,
      fakeDiscoveryResult(uuid),
    );

    assert(recorded, "A live, non-abandoned completion must be recorded");
    assertEquals(neat.discoveryComplete.length, 1);
    assertEquals(
      neat.discoveryInProgress.has(uuid),
      false,
      "recording a completion releases the in-progress bookkeeping",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("recordDiscoveryComplete: discards late completion after hard-deadline abandon", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const uuid = "disc-late";
    // Schedule-time token captured before the task is abandoned.
    const epoch = neat.abandonEpoch;
    neat.discoveryInProgress.set(uuid, new Promise(() => {}));

    // Hard-deadline abandon clears the maps and bumps the abandon token.
    neat.abandonInFlightPastHardDeadline(Date.now() - 1000);

    const recorded = neat.recordDiscoveryComplete(
      uuid,
      epoch,
      fakeDiscoveryResult(uuid),
    );

    assertEquals(
      recorded,
      false,
      "A late completion after abandon is discarded",
    );
    assertEquals(
      neat.discoveryComplete.length,
      0,
      "no result blob may re-inflate discoveryComplete after abandon",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("recordDiscoveryComplete: discards when the task is no longer tracked", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const uuid = "disc-untracked";
    const epoch = neat.abandonEpoch;
    // Never registered in discoveryInProgress (e.g. cleared by a per-task abandon).

    const recorded = neat.recordDiscoveryComplete(
      uuid,
      epoch,
      fakeDiscoveryResult(uuid),
    );

    assertEquals(recorded, false, "An untracked completion is discarded");
    assertEquals(neat.discoveryComplete.length, 0);
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("recordTrainingComplete: records a completion for a live task", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const uuid = "train-live";
    const epoch = neat.abandonEpoch;
    neat.trainingInProgress.set(uuid, Promise.resolve());
    neat.trainingDeadlines.set(uuid, Date.now() + 60_000);

    const recorded = neat.recordTrainingComplete(
      uuid,
      epoch,
      fakeTrainingResult(uuid),
    );

    assert(recorded, "A live, non-abandoned completion must be recorded");
    assertEquals(neat.trainingComplete.length, 1);
    assertEquals(neat.trainingInProgress.has(uuid), false);
    assertEquals(
      neat.trainingDeadlines.has(uuid),
      false,
      "recording a completion releases the per-task deadline",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("recordTrainingComplete: discards late completion after hard-deadline abandon", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const uuid = "train-late";
    const epoch = neat.abandonEpoch;
    neat.trainingInProgress.set(uuid, new Promise(() => {}));
    neat.trainingDeadlines.set(uuid, Date.now() + 60_000);

    neat.abandonInFlightPastHardDeadline(Date.now() - 1000);

    const recorded = neat.recordTrainingComplete(
      uuid,
      epoch,
      fakeTrainingResult(uuid),
    );

    assertEquals(
      recorded,
      false,
      "A late completion after abandon is discarded",
    );
    assertEquals(
      neat.trainingComplete.length,
      0,
      "no result blob may re-inflate trainingComplete after abandon",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("abandonInFlightPastHardDeadline: bumps the abandon token so prior tasks are invalidated", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const epochBefore = neat.abandonEpoch;
    assertEquals(
      neat.isRunAbandonedSince(epochBefore),
      false,
      "a freshly captured token is not abandoned",
    );

    neat.trainingInProgress.set("t", new Promise(() => {}));
    neat.abandonInFlightPastHardDeadline(Date.now() - 1000);

    assert(
      neat.isRunAbandonedSince(epochBefore),
      "the token captured before abandon must now read as abandoned",
    );
    // A task scheduled after the abandon captures the new token and is honoured.
    const epochAfter = neat.abandonEpoch;
    assertEquals(neat.isRunAbandonedSince(epochAfter), false);
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("abandon before the cap does not invalidate scheduled tasks", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);
  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const epoch = neat.abandonEpoch;
    neat.trainingInProgress.set("t", Promise.resolve());

    // Deadline in the future: no abandon, token unchanged.
    neat.abandonInFlightPastHardDeadline(Date.now() + 60_000);

    assertEquals(neat.isRunAbandonedSince(epoch), false);
    const recorded = neat.recordTrainingComplete(
      "t",
      epoch,
      fakeTrainingResult("t"),
    );
    assert(recorded, "completion before the cap is still recorded");
    assertEquals(neat.trainingComplete.length, 1);
  } finally {
    await terminateWorkers(workers);
  }
});
