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

// ============================================================================
// Issue #2871: Training is an optional/best-effort phase and must NEVER be
// able to wedge the run. A training task whose worker promise never settles
// (e.g. a timed-out per-creature CPU score) must be abandoned after a bounded
// wait so the run can finalize and check in the best-so-far creature.
// ============================================================================

Deno.test("finishUp: training timeout clears stuck trainings", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // A training promise that never settles (mimics an orphaned timed-out
    // worker task that never resolves nor rejects).
    neat.trainingInProgress.set("stuck-train-uuid", new Promise(() => {}));

    // Call finishUp repeatedly with iterations=4 to bound the wait at 2.
    let cleared = false;
    for (let i = 0; i < 10; i++) {
      const result = neat.finishUp(4);
      if (neat.trainingInProgress.size === 0 || result === true) {
        cleared = true;
        break;
      }
    }

    assert(cleared, "Training should be cleared after timeout generations");
    assertEquals(
      neat.trainingInProgress.size,
      0,
      "Training map should be empty after timeout",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: clears stuck trainings promptly when wall-clock deadline has passed", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate a stuck (never-settling) training task.
    neat.trainingInProgress.set("expired-train-uuid", new Promise(() => {}));

    // Wall-clock deadline already in the past (caller's --timeout exceeded).
    const start = Date.now() - 10 * 60_000; // ran for 10 minutes
    const endTimeMS = Date.now() - 60_000; // 1 minute past deadline
    const iterations = 1000; // generous cap — must NOT keep the run alive
    const currentGeneration = 5;

    let cleared = false;
    for (let i = 0; i < 5; i++) {
      neat.finishUp(iterations, endTimeMS, start, currentGeneration);
      if (neat.trainingInProgress.size === 0) {
        cleared = true;
        break;
      }
    }
    assert(
      cleared,
      "Stuck training should be cleared within a few generations after the wall-clock deadline expires",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("finishUp: eventually finalizes despite a never-settling training task", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Orphaned training promise that will never settle.
    neat.trainingInProgress.set("never-settles", new Promise(() => {}));

    // Drive the finish-up loop with a bounded iteration cap. It must reach a
    // terminal `true` (finalize + checkin) rather than spinning forever.
    let finalized = false;
    for (let i = 0; i < 50; i++) {
      if (neat.finishUp(4)) {
        finalized = true;
        break;
      }
    }

    assert(
      finalized,
      "Run must finalize even when a training task never settles",
    );
    assertEquals(
      neat.trainingInProgress.size,
      0,
      "Stuck training must be abandoned before finalizing",
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

// ============================================================================
// Issue #2432: Wall-clock takes precedence over generation-count fallback
// ============================================================================

Deno.test("finishUp: clears stuck discoveries promptly when wall-clock deadline has passed", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 10 };
    const neat = new Neat(2, 1, options, workers);

    // Simulate a stuck discovery
    neat.discoveryInProgress.set("expired-uuid", new Promise(() => {}));

    // Wall-clock deadline already in the past (caller's --timeout exceeded)
    const start = Date.now() - 10 * 60_000; // ran for 10 minutes
    const endTimeMS = Date.now() - 60_000; // 1 minute past deadline
    const iterations = 1000; // generous iteration cap — must NOT save the stuck discovery
    const currentGeneration = 5;

    // First call should bound the wait by wall-clock, NOT by the iteration
    // count fallback (which was 20 generations historically).
    let cleared = false;
    for (let i = 0; i < 5; i++) {
      neat.finishUp(iterations, endTimeMS, start, currentGeneration);
      if (neat.discoveryInProgress.size === 0) {
        cleared = true;
        break;
      }
    }
    assert(
      cleared,
      "Stuck discovery should be cleared within a few generations after wall-clock deadline expires",
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
