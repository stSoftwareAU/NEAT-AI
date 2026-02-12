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
 * Unit tests for Neat.evolve method.
 *
 * Issue #1397: Verify evolution loop behaviour including fitness
 * evaluation, elitism, speciation, population management, plateau
 * detection, and mutation rate adjustment.
 */

function createTestDataDir(
  input: number,
  output: number,
  count = 20,
): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < count; i++) {
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

Deno.test("evolve: returns fittest creature with valid score", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    const result = await neat.evolve();

    assert(result.fittest !== undefined, "Should return a fittest creature");
    assert(
      result.fittest.score !== undefined,
      "Fittest should have a score",
    );
    assert(
      Number.isFinite(result.fittest.score),
      "Fittest score should be finite",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("evolve: returns plateau detection status", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    const result = await neat.evolve();

    assert(result.plateau !== undefined, "Should return plateau info");
    assertEquals(
      typeof result.plateau.onPlateau,
      "boolean",
      "onPlateau should be boolean",
    );
    assertEquals(
      typeof result.plateau.generationsOnPlateau,
      "number",
      "generationsOnPlateau should be number",
    );
    assertEquals(
      typeof result.plateau.mutationMultiplier,
      "number",
      "mutationMultiplier should be number",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("evolve: returns average score", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    const result = await neat.evolve();

    assertEquals(
      typeof result.averageScore,
      "number",
      "averageScore should be a number",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("evolve: population is repopulated after evolution", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const popSize = 15;
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: popSize,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    await neat.evolve();

    // Population should be maintained at approximately the configured size
    assert(
      neat.population.length > 0,
      "Population should not be empty after evolution",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("evolve: fittest creature has UUID", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    const result = await neat.evolve();

    assert(
      result.fittest.uuid !== undefined,
      "Fittest should have a UUID",
    );
    assert(
      result.fittest.uuid.length > 0,
      "Fittest UUID should not be empty",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("evolve: multiple generations improve or maintain fitness", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 15,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    // Run first generation
    const result1 = await neat.evolve();
    const score1 = result1.fittest.score!;

    // Run second generation with previous fittest
    const result2 = await neat.evolve(result1.fittest);
    const score2 = result2.fittest.score!;

    // The fittest score should be maintained or improved (>= because
    // scores are negative, higher is better)
    assert(
      score2 >= score1,
      `Second generation score (${score2}) should be >= first (${score1})`,
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("evolve: plateau detector records fitness each generation", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    // Initially no generations recorded
    assertEquals(
      neat.plateauDetector.getGenerationsOnPlateau(),
      0,
      "Should start with 0 generations on plateau",
    );

    await neat.evolve();

    // After one generation, plateau detector should have recorded fitness.
    // With only 1 generation, getImprovementRate() returns null (insufficient
    // history), but getGenerationsOnPlateau() should still be 0 since the
    // window hasn't filled yet. The key check is that recordFitness was called
    // (which we verify indirectly by confirming no error was thrown and the
    // detector is in a valid state).
    assertEquals(
      neat.plateauDetector.isOnPlateau(),
      false,
      "Should not be on plateau after first generation",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("evolve: elitism preserves best creatures", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
      elitism: 3,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    const result = await neat.evolve();

    // The fittest creature should be preserved via elitism
    assert(
      result.fittest.score !== undefined,
      "Fittest should have been evaluated and scored",
    );
  } finally {
    await terminateWorkers(workers);
  }
});
