import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * Unit tests for Neat.abandonInFlightPastHardDeadline() — Issue #2896.
 *
 * The finish-up cycle must break out of the evolve loop unconditionally once
 * the absolute T+15 hard cap passes, abandoning any in-flight discovery/training
 * bookkeeping so the abandoned promises cannot be re-awaited. Assertions are
 * behavioural (state + return value), not elapsed-time measurements (#2888).
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

Deno.test("abandonInFlightPastHardDeadline: breaks and abandons in-flight tasks once the cap has passed", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Never-settling discovery/training tasks that would otherwise wedge the run.
    neat.discoveryInProgress.set("stuck-disc", new Promise(() => {}));
    neat.trainingInProgress.set("stuck-train", new Promise(() => {}));

    // Hard deadline already in the past.
    const broke = neat.abandonInFlightPastHardDeadline(Date.now() - 1000);

    assert(broke, "Should signal a break once the hard deadline has passed");
    assertEquals(
      neat.discoveryInProgress.size,
      0,
      "discoveryInProgress must be empty after the forced break",
    );
    assertEquals(
      neat.trainingInProgress.size,
      0,
      "trainingInProgress must be empty after the forced break",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("abandonInFlightPastHardDeadline: does not break or abandon before the cap", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.discoveryInProgress.set("disc", Promise.resolve());
    neat.trainingInProgress.set("train", Promise.resolve());

    // Hard deadline well in the future.
    const broke = neat.abandonInFlightPastHardDeadline(Date.now() + 60_000);

    assertEquals(broke, false, "Should not break before the hard deadline");
    assertEquals(
      neat.discoveryInProgress.size,
      1,
      "Discovery bookkeeping must be untouched before the cap",
    );
    assertEquals(
      neat.trainingInProgress.size,
      1,
      "Training bookkeeping must be untouched before the cap",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("abandonInFlightPastHardDeadline: zero deadline disables the cap entirely", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.trainingInProgress.set("train", Promise.resolve());

    // 0 means "no timeout configured" → no cap, regardless of wall clock.
    const broke = neat.abandonInFlightPastHardDeadline(0);

    assertEquals(
      broke,
      false,
      "A zero hard deadline must never break the loop",
    );
    assertEquals(
      neat.trainingInProgress.size,
      1,
      "Training bookkeeping must be untouched when the cap is disabled",
    );
  } finally {
    await terminateWorkers(workers);
  }
});
