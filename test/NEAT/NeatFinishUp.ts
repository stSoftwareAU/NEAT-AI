import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * Unit tests for Neat.finishUp method.
 *
 * Issue #1397: Verify the finish-up logic that controls when
 * evolution should stop, including handling of in-progress discovery
 * and training, clean-up delays, and additional generation counts.
 *
 * Issue #1749: Additional coverage for discovery/training in-progress
 * scenarios, cleanup delays, and timeout calculations.
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

Deno.test("finishUp: returns true when no in-progress work and no delays", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    // First call sets doNotStartMore=true
    // With no in-progress work, should return true
    const result = neat.finishUp();

    assertEquals(result, true, "Should return true when nothing in progress");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: returns true on multiple calls with no in-progress work", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    // Multiple calls should all return true
    const result1 = neat.finishUp();
    const result2 = neat.finishUp();
    const result3 = neat.finishUp();

    assertEquals(result1, true);
    assertEquals(result2, true);
    assertEquals(result3, true);
  } finally {
    await terminateWorkers(workers);
  }
});

// ============================================================================
// Issue #1749: Discovery and Training In-Progress
// ============================================================================

Deno.test("finishUp: returns false when training is in progress", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate training in progress
    neat.trainingInProgress.set("train-uuid", Promise.resolve());

    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should return false when training in progress",
    );
    assertEquals(neat.doNotStartMore, true, "doNotStartMore should be set");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: returns false when discovery is in progress", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate discovery in progress
    neat.discoveryInProgress.set("disc-uuid", Promise.resolve());

    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should return false when discovery in progress",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: discovery timeout clears stuck discoveries", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate discovery in progress
    neat.discoveryInProgress.set("stuck-uuid", Promise.resolve());

    // Call finishUp repeatedly with iterations=4 to set max wait to 2
    let cleared = false;
    for (let i = 0; i < 10; i++) {
      const result = neat.finishUp(4);
      if (neat.discoveryInProgress.size === 0 || result === true) {
        cleared = true;
        break;
      }
    }

    assert(cleared, "Discovery should be cleared after timeout generations");
    assertEquals(
      neat.discoveryInProgress.size,
      0,
      "Discovery map should be empty after timeout",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: returns false when additionalGenerationCount > 0", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    neat.additionalGenerationCount = 5;

    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should return false when additional generations remain",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: sets cleanup delay when work was in progress", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate training in progress on first call
    neat.trainingInProgress.set("uuid-1", Promise.resolve());
    neat.finishUp();

    // Now clear the in-progress work
    neat.trainingInProgress.clear();

    // Should still return false due to cleanup delay
    const result = neat.finishUp();
    assertEquals(
      result,
      false,
      "Should wait for cleanup delay after work completes",
    );
  } finally {
    await terminateWorkers(workers);
  }
});
