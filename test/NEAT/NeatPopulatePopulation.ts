import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import {
  creatureForProblem,
  CURRENT_GENERATION_TAG,
  WARMUP_GENERATIONS_TAG,
} from "@architecture/CreatureFactory.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

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

    await neat.populatePopulation(seedCreature);

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

    await neat.populatePopulation(seedCreature);

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

    await neat.populatePopulation(seedCreature);

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

    await neat.populatePopulation(seedCreature);

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

    await neat.populatePopulation(seedCreature);

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
    await neat.populatePopulation(seedCreature);

    assertEquals(
      neat.population.length,
      10,
      "Population should be filled to populationSize",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: seeds counter from saved currentGeneration tag (resume)", async () => {
  // Issue #2908: the lineage-accumulated generation counter must resume from
  // the saved tag value so a run can pick up where the previous one left off.
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 5 };
    const neat = new Neat(3, 2, options, workers);

    const seedCreature = creatureForProblem({
      inputs: 3,
      outputs: 2,
      cost: "MSE",
      warmupGenerations: 1440,
    });
    addTag(seedCreature, CURRENT_GENERATION_TAG, "42");

    await neat.populatePopulation(seedCreature);

    assertEquals(
      neat.currentGeneration,
      42,
      "Counter should resume from the saved tag value",
    );

    // The next generation increments to 43 (single increment writer).
    neat.currentGeneration++;
    assertEquals(
      neat.currentGeneration,
      43,
      "Next generation should increment to 43",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: never lowers an already-higher in-memory counter", async () => {
  // Issue #2908: seeding is monotonic-max — a lower saved tag must not reset
  // a counter that has already accumulated further this run.
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 5 };
    const neat = new Neat(3, 2, options, workers);
    neat.currentGeneration = 100;

    const seedCreature = creatureForProblem({
      inputs: 3,
      outputs: 2,
      cost: "MSE",
      warmupGenerations: 1440,
    });
    addTag(seedCreature, CURRENT_GENERATION_TAG, "7");

    await neat.populatePopulation(seedCreature);

    assertEquals(
      neat.currentGeneration,
      100,
      "A lower saved tag must not lower the in-memory counter",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: missing tag leaves a higher in-memory counter untouched", async () => {
  // Issue #2908: a seed with no currentGeneration tag must not reset the
  // counter to zero.
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 5 };
    const neat = new Neat(3, 2, options, workers);
    neat.currentGeneration = 50;

    const seedCreature = new Creature(3, 2, { layers: [{ count: 3 }] });

    await neat.populatePopulation(seedCreature);

    assertEquals(
      neat.currentGeneration,
      50,
      "A missing tag must not lower the in-memory counter",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: restores warm-up tags from seed creature", async () => {
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = { populationSize: 5 };
    const neat = new Neat(3, 2, options, workers);

    const seedCreature = creatureForProblem({
      inputs: 3,
      outputs: 2,
      cost: "MSE",
      warmupGenerations: 20,
    });
    addTag(seedCreature, CURRENT_GENERATION_TAG, "7");

    await neat.populatePopulation(seedCreature);

    assertEquals(neat.warmupGenerations, 20);
    assertEquals(neat.currentGeneration, 7);

    const seedJson = neat.population[0].exportJSON();
    const warmupTag = seedJson.tags?.find((t) =>
      t.name === WARMUP_GENERATIONS_TAG
    );
    assertEquals(warmupTag?.value, "20");
  } finally {
    await terminateWorkers(workers);
  }
});
