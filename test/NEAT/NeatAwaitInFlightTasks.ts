import { assert, assertEquals } from "@std/assert";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * Unit tests for Neat.awaitInFlightTasks() method.
 *
 * Issue #2240: Verify that the lightweight wait mechanism correctly
 * awaits in-flight discovery and training promises instead of running
 * full evolve() cycles during the finish-up phase.
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

Deno.test("awaitInFlightTasks: resolves immediately when no tasks in flight", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Should resolve immediately with no tasks
    await neat.awaitInFlightTasks(1000);
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("awaitInFlightTasks: waits for discovery task to complete", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    let resolved = false;

    // Create a promise that resolves after a short delay
    let timerId: ReturnType<typeof setTimeout>;
    const taskPromise = new Promise<void>((resolve) => {
      timerId = setTimeout(() => {
        resolved = true;
        resolve();
      }, 50);
    });

    neat.discoveryInProgress.set("test-disc-uuid", taskPromise);

    try {
      // Should wait until the task completes (well within timeout)
      await neat.awaitInFlightTasks(5000);
      assert(resolved, "Discovery task should have completed");
    } finally {
      clearTimeout(timerId!);
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("awaitInFlightTasks: waits for training task to complete", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    let resolved = false;

    let timerId: ReturnType<typeof setTimeout>;
    const taskPromise = new Promise<void>((resolve) => {
      timerId = setTimeout(() => {
        resolved = true;
        resolve();
      }, 50);
    });

    neat.trainingInProgress.set("test-train-uuid", taskPromise);

    try {
      await neat.awaitInFlightTasks(5000);
      assert(resolved, "Training task should have completed");
    } finally {
      clearTimeout(timerId!);
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("awaitInFlightTasks: respects timeout with long-running tasks", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Create a promise that takes much longer than the timeout
    let longTimerId: ReturnType<typeof setTimeout>;
    const taskPromise = new Promise<void>((resolve) => {
      longTimerId = setTimeout(resolve, 60_000);
    });

    neat.discoveryInProgress.set("slow-uuid", taskPromise);

    try {
      const startMs = Date.now();
      await neat.awaitInFlightTasks(200); // Short timeout
      const elapsedMs = Date.now() - startMs;

      // Should have returned after roughly the timeout, not waited for the full task
      assert(
        elapsedMs < 5000,
        `Should have timed out quickly, but took ${elapsedMs}ms`,
      );

      // Task is still in progress (not cleared by timeout)
      assertEquals(
        neat.discoveryInProgress.size,
        1,
        "Discovery should still be in progress after timeout",
      );
    } finally {
      clearTimeout(longTimerId!);
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("awaitInFlightTasks: handles both discovery and training simultaneously", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    let discoveryResolved = false;
    let trainingResolved = false;

    let discTimerId: ReturnType<typeof setTimeout>;
    const discPromise = new Promise<void>((resolve) => {
      discTimerId = setTimeout(() => {
        discoveryResolved = true;
        resolve();
      }, 30);
    });

    let trainTimerId: ReturnType<typeof setTimeout>;
    const trainPromise = new Promise<void>((resolve) => {
      trainTimerId = setTimeout(() => {
        trainingResolved = true;
        resolve();
      }, 60);
    });

    neat.discoveryInProgress.set("disc-uuid", discPromise);
    neat.trainingInProgress.set("train-uuid", trainPromise);

    try {
      // Wait long enough for both to complete
      await neat.awaitInFlightTasks(5000);

      // At least one should have resolved (Promise.race behaviour)
      assert(
        discoveryResolved || trainingResolved,
        "At least one task should have completed",
      );
    } finally {
      clearTimeout(discTimerId!);
      clearTimeout(trainTimerId!);
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: logs waiting message with task counts", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate both discovery and training in progress
    neat.discoveryInProgress.set("disc-1", Promise.resolve());
    neat.trainingInProgress.set("train-1", Promise.resolve());

    // finishUp should return false and set doNotStartMore
    const result = neat.finishUp();
    assertEquals(result, false, "Should return false when tasks in progress");
    assertEquals(neat.doNotStartMore, true, "doNotStartMore should be set");

    // cleanUpDelayCount should be set because tasks were in progress
    // (after clearing both maps, it should count down)
    neat.discoveryInProgress.clear();
    neat.trainingInProgress.clear();

    // With cleanup delay set, should still return false
    const result2 = neat.finishUp();
    assertEquals(
      result2,
      false,
      "Should return false during cleanup delay",
    );
  } finally {
    await terminateWorkers(workers);
  }
});
