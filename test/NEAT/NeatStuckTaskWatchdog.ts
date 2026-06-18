import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * Unit tests for Neat.abandonStuckTrainingTasks() — the incremental
 * stuck-task watchdog (Issue #3053).
 *
 * A training task whose worker promise never settles must be abandoned
 * promptly and individually once it overruns its own per-task deadline, rather
 * than lingering until the generation-count or hard-deadline batch clear.
 * Assertions are behavioural (map state + returned UUIDs) with an injected
 * clock — no elapsed-time measurement (#2888 policy).
 */

function createTestDataDir(input: number, output: number): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      input: new Float32Array(Array.from({ length: input }, () => 0.5)),
      output: new Float32Array(Array.from({ length: output }, () => 0.5)),
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

Deno.test("abandonStuckTrainingTasks: abandons only the task past its own deadline", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const now = 1_000_000_000_000;
    // 'stuck' expired well before now; 'fresh' is still in the future.
    neat.trainingInProgress.set("stuck", new Promise(() => {}));
    neat.trainingDeadlines.set("stuck", now - 120_000);
    neat.trainingInProgress.set("fresh", new Promise(() => {}));
    neat.trainingDeadlines.set("fresh", now + 120_000);

    const abandoned = neat.abandonStuckTrainingTasks(now, 30_000);

    assertEquals(abandoned, ["stuck"], "Only the overrun task is abandoned");
    assertEquals(neat.trainingInProgress.has("stuck"), false);
    assertEquals(neat.trainingDeadlines.has("stuck"), false);
    assert(
      neat.trainingInProgress.has("fresh"),
      "The in-budget task must be untouched",
    );
    assert(neat.trainingDeadlines.has("fresh"));
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("abandonStuckTrainingTasks: respects the grace window", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const now = 1_000_000_000_000;
    // Deadline is 10s in the past — inside the 30s grace, so not yet abandoned.
    neat.trainingInProgress.set("recent", new Promise(() => {}));
    neat.trainingDeadlines.set("recent", now - 10_000);

    const abandoned = neat.abandonStuckTrainingTasks(now, 30_000);

    assertEquals(abandoned.length, 0, "Within grace → not abandoned");
    assert(neat.trainingInProgress.has("recent"));
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("abandonStuckTrainingTasks: a zero deadline is never abandoned", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    const now = 1_000_000_000_000;
    neat.trainingInProgress.set("no-deadline", new Promise(() => {}));
    neat.trainingDeadlines.set("no-deadline", 0);

    const abandoned = neat.abandonStuckTrainingTasks(now, 30_000);

    assertEquals(abandoned.length, 0, "A 0 deadline means no per-task cap");
    assert(neat.trainingInProgress.has("no-deadline"));
  } finally {
    await terminateWorkers(workers);
  }
});
