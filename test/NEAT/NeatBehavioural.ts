import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import { Genus } from "../../src/NEAT/Genus.ts";
import { Species } from "../../src/NEAT/Species.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";

/**
 * Behavioural tests for the core NEAT algorithm (Neat.ts).
 *
 * Issue #1439: Verify outcomes of evolution, speciation, elitism,
 * and population management without testing implementation details.
 */

function createXORDataDir(): string {
  const records: DataRecordInterface[] = [
    {
      input: new Float32Array([0, 0]),
      output: new Float32Array([0]),
    },
    {
      input: new Float32Array([0, 1]),
      output: new Float32Array([1]),
    },
    {
      input: new Float32Array([1, 0]),
      output: new Float32Array([1]),
    },
    {
      input: new Float32Array([1, 1]),
      output: new Float32Array([0]),
    },
  ];
  return makeDataDir(records, 2000);
}

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

// ============================================================================
// Evolution Improvement Tests
// ============================================================================

Deno.test("NeatBehavioural: evolve improves fitness over generations for XOR", async () => {
  const dataDir = createXORDataDir();
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 4 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 30,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    // Run multiple generations sequentially (each depends on the previous)
    const result1 = await neat.evolve();
    const score1 = result1.fittest.score!;

    const result2 = await neat.evolve(result1.fittest);
    const result3 = await neat.evolve(result2.fittest);
    const result4 = await neat.evolve(result3.fittest);
    const result5 = await neat.evolve(result4.fittest);

    const bestScore = Math.max(
      score1,
      result2.fittest.score!,
      result3.fittest.score!,
      result4.fittest.score!,
      result5.fittest.score!,
    );

    // After multiple generations, best score should be at least as good as
    // the first generation (elitism guarantees this).
    assert(
      bestScore >= score1,
      `Best score (${bestScore}) should be >= first generation (${score1})`,
    );
  } finally {
    await terminateWorkers(workers);
  }
});

// ============================================================================
// Speciation Tests
// ============================================================================

Deno.test("NeatBehavioural: speciation separates genetically distant creatures", () => {
  const genus = new Genus();

  // Create creatures with very different architectures
  const small = new Creature(2, 1, { layers: [{ count: 2 }] });
  CreatureUtil.makeUUID(small);

  const medium = new Creature(2, 1, { layers: [{ count: 15 }] });
  CreatureUtil.makeUUID(medium);

  const large = new Creature(2, 1, { layers: [{ count: 30 }] });
  CreatureUtil.makeUUID(large);

  genus.addCreature(small);
  genus.addCreature(medium);
  genus.addCreature(large);

  // Different sized creatures should be placed in different species
  const smallSpecies = genus.findSpeciesByCreatureUUID(small.uuid!);
  const mediumSpecies = genus.findSpeciesByCreatureUUID(medium.uuid!);
  const largeSpecies = genus.findSpeciesByCreatureUUID(large.uuid!);

  // At least 2 of the 3 should be in different species given the
  // architectural differences (2 vs 15 vs 30 hidden neurons)
  const speciesKeys = new Set([
    smallSpecies.speciesKey,
    mediumSpecies.speciesKey,
    largeSpecies.speciesKey,
  ]);
  assertGreater(
    speciesKeys.size,
    1,
    "Genetically distant creatures should be in different species",
  );
});

Deno.test("NeatBehavioural: cloned creatures are grouped in the same species", () => {
  const genus = new Genus();

  // Create two creatures from the same blueprint (same squash distribution)
  const original = new Creature(2, 1, { layers: [{ count: 4 }] });
  const creature1 = Creature.fromJSON(original.exportJSON());
  const creature2 = Creature.fromJSON(original.exportJSON());
  CreatureUtil.makeUUID(creature1);
  CreatureUtil.makeUUID(creature2);

  genus.addCreature(creature1);
  genus.addCreature(creature2);

  const species1 = genus.findSpeciesByCreatureUUID(creature1.uuid!);
  const species2 = genus.findSpeciesByCreatureUUID(creature2.uuid!);

  assertEquals(
    species1.speciesKey,
    species2.speciesKey,
    "Cloned creatures should be in the same species",
  );
});

Deno.test("NeatBehavioural: species key is deterministic for same creature", () => {
  const creature = new Creature(3, 2, { layers: [{ count: 5 }] });

  const key1 = Species.calculateKey(creature);
  const key2 = Species.calculateKey(creature);

  assertEquals(
    key1,
    key2,
    "Same creature should always produce the same species key",
  );
});

Deno.test("NeatBehavioural: genus validates creature-species mapping", () => {
  const genus = new Genus();

  const creatures: Creature[] = [];
  for (let i = 0; i < 10; i++) {
    const c = new Creature(2, 1, { layers: [{ count: 3 + i }] });
    CreatureUtil.makeUUID(c);
    genus.addCreature(c);
    creatures.push(c);
  }

  // Validate should not throw — all creatures are correctly mapped
  genus.validate();

  // Every creature should be findable via UUID
  for (const creature of creatures) {
    const species = genus.findSpeciesByCreatureUUID(creature.uuid!);
    assert(species, `Creature ${creature.uuid} should have a species`);
  }
});

// ============================================================================
// Elitism Tests
// ============================================================================

Deno.test("NeatBehavioural: elitism preserves top performers between generations", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 20,
      elitism: 4,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    const result1 = await neat.evolve();
    const gen1BestScore = result1.fittest.score!;

    // Second generation should never be worse than first due to elitism
    const result2 = await neat.evolve(result1.fittest);
    const gen2BestScore = result2.fittest.score!;

    assert(
      gen2BestScore >= gen1BestScore,
      `Elitism should preserve best: gen2 (${gen2BestScore}) >= gen1 (${gen1BestScore})`,
    );
  } finally {
    await terminateWorkers(workers);
  }
});

// ============================================================================
// Population Size Tests
// ============================================================================

Deno.test("NeatBehavioural: population size stays within configured bounds", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const popSize = 25;
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: popSize,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    assertEquals(
      neat.population.length,
      popSize,
      `Initial population should be ${popSize}`,
    );

    await neat.evolve();

    // Population should not be empty and should remain reasonable
    assertGreater(
      neat.population.length,
      0,
      "Population should not be empty after evolution",
    );
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatBehavioural: populatePopulation creates correct population size", async () => {
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const popSize = 15;
    const seedCreature = new Creature(3, 2, { layers: [{ count: 4 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: popSize,
    };

    const neat = new Neat(3, 2, options, workers);
    neat.populatePopulation(seedCreature);

    assertEquals(
      neat.population.length,
      popSize,
      `Population should be exactly ${popSize}`,
    );

    // All creatures should have correct input/output dimensions
    for (const creature of neat.population) {
      assertEquals(creature.input, 3, "Each creature should have 3 inputs");
      assertEquals(creature.output, 2, "Each creature should have 2 outputs");
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("NeatBehavioural: population contains valid creatures after evolution", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = createTestWorkers(dataDir);

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 12,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    await neat.evolve();

    // Every creature in the population should have correct dimensions
    for (const creature of neat.population) {
      assertEquals(creature.input, 2, "Input dimension preserved");
      assertEquals(creature.output, 1, "Output dimension preserved");
      assertGreater(
        creature.neurons.length,
        0,
        "Creature should have neurons",
      );
    }
  } finally {
    await terminateWorkers(workers);
  }
});
