import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";

/**
 * Unit tests for Neat.populatePopulation method.
 *
 * Issue #1397: Verify that populatePopulation correctly fills the
 * population to the configured size with mutated variants of the
 * seed creature, and runs de-duplication.
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

function createTestWorkers(dataDir: string): WorkerHandler[] {
  return [new WorkerHandler(dataDir, "MSE", true)];
}

async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
}

Deno.test("populatePopulation: fills population to configured size", async () => {
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const populationSize = 15;
    const options: NeatOptions = {
      populationSize,
    };

    const neat = new Neat(3, 2, options, workers);
    const seedCreature = new Creature(3, 2, { layers: [{ count: 4 }] });

    neat.populatePopulation(seedCreature);

    assertEquals(
      neat.population.length,
      populationSize,
      `Population should be ${populationSize}`,
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: seed creature is first in population", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const seedUUID = CreatureUtil.makeUUID(seedCreature);

    neat.populatePopulation(seedCreature);

    assertEquals(
      neat.population[0],
      seedCreature,
      "First creature should be the seed creature",
    );
    assertEquals(
      neat.population[0].uuid,
      seedUUID,
      "First creature UUID should match seed",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: all creatures have UUIDs", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });

    neat.populatePopulation(seedCreature);

    for (let i = 0; i < neat.population.length; i++) {
      assert(
        neat.population[i].uuid !== undefined,
        `Creature ${i} should have a UUID`,
      );
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: creatures have correct input/output dimensions", async () => {
  const dataDir = createTestDataDir(4, 3);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 8,
    };

    const neat = new Neat(4, 3, options, workers);
    const seedCreature = new Creature(4, 3, { layers: [{ count: 5 }] });

    neat.populatePopulation(seedCreature);

    for (let i = 0; i < neat.population.length; i++) {
      const creature = neat.population[i];
      assertEquals(
        creature.input,
        4,
        `Creature ${i} should have 4 inputs`,
      );
      assertEquals(
        creature.output,
        3,
        `Creature ${i} should have 3 outputs`,
      );
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: population has diversity (not all identical)", async () => {
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 20,
    };

    const neat = new Neat(3, 2, options, workers);
    const seedCreature = new Creature(3, 2, { layers: [{ count: 5 }] });

    neat.populatePopulation(seedCreature);

    // Collect unique UUIDs
    const uuids = new Set(neat.population.map((c) => c.uuid));

    assert(
      uuids.size > 1,
      "Population should have diverse creatures (multiple unique UUIDs)",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: works with existing population", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const creature1 = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [creature1.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    assertEquals(neat.population.length, 1, "Should start with 1 creature");

    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    neat.populatePopulation(seedCreature);

    assertEquals(
      neat.population.length,
      10,
      "Population should be filled to populationSize",
    );
  } finally {
    await terminateWorkers(workers);
  }
});
