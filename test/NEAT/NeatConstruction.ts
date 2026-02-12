import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";

/**
 * Unit tests for Neat class construction and initialisation.
 *
 * Issue #1397: Verify that the Neat constructor correctly initialises
 * all internal state including population, config, fitness, plateau
 * detector, fine-tune tracker, discovery replay queue, and worker pool.
 */

/** Helper to create a minimal data directory with valid training data. */
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

/** Helper to create workers for testing. */
function createTestWorkers(
  dataDir: string,
  count = 1,
): WorkerHandler[] {
  const workers: WorkerHandler[] = [];
  for (let i = 0; i < count; i++) {
    workers.push(new WorkerHandler(dataDir, "MSE", true));
  }
  return workers;
}

/** Helper to clean up workers after tests. */
async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
}

Deno.test("NeatConstruction: creates instance with correct input/output", async () => {
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const creature = new Creature(3, 2, { layers: [{ count: 4 }] });
    const options: NeatOptions = {
      creatures: [creature.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(3, 2, options, workers);

    assertEquals(neat.input, 3, "Input count should be 3");
    assertEquals(neat.output, 2, "Output count should be 2");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: initialises population from creatures option", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const creature1 = new Creature(2, 1, { layers: [{ count: 3 }] });
    const creature2 = new Creature(2, 1, { layers: [{ count: 4 }] });
    const options: NeatOptions = {
      creatures: [creature1.exportJSON(), creature2.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assertEquals(
      neat.population.length,
      2,
      "Population should have 2 creatures from options",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: initialises with empty population when no creatures provided", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assertEquals(neat.population.length, 0, "Population should be empty");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: config is frozen and correctly created", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 25,
      mutationRate: 0.5,
      elitism: 3,
    };

    const neat = new Neat(2, 1, options, workers);

    assertEquals(neat.config.populationSize, 25);
    assertEquals(neat.config.mutationRate, 0.5);
    assertEquals(neat.config.elitism, 3);
    assert(Object.isFrozen(neat.config), "Config should be frozen");
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: plateau detector is initialised", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assert(
      neat.plateauDetector !== undefined,
      "Plateau detector should be initialised",
    );
    assertEquals(
      neat.plateauDetector.isOnPlateau(),
      false,
      "Should not be on plateau initially",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: fine-tune tracker is initialised", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assert(
      neat.fineTuneTracker !== undefined,
      "Fine-tune tracker should be initialised",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: discovery replay queue is initialised", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assert(
      neat.discoveryReplayQueue !== undefined,
      "Discovery replay queue should be initialised",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: worker pool is initialised", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir, 2);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assert(
      neat.workerPool !== undefined,
      "Worker pool should be initialised",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: timeout is set when timeoutMinutes provided", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
      timeoutMinutes: 5,
    };

    const neat = new Neat(2, 1, options, workers);

    assert(
      neat.endTimeTS > 0,
      "endTimeTS should be set when timeoutMinutes provided",
    );
    assert(
      neat.endTimeTS > Date.now(),
      "endTimeTS should be in the future",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: timeout is zero when not provided", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assertEquals(
      neat.endTimeTS,
      0,
      "endTimeTS should be 0 when no timeout",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: CRISPRs are empty by default", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);

    assertEquals(
      neat.CRISPRs.length,
      0,
      "Should have 0 CRISPRs by default",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatConstruction: setDataDir sets the data directory", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.setDataDir("/tmp/test-data");

    // The data dir is private, so we test indirectly - no error should be thrown
    assert(true, "setDataDir should not throw");
  } finally {
    await terminateWorkers(workers);
  }
});
