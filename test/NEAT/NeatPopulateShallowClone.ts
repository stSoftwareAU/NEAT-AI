import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

/**
 * Tests verifying that populatePopulation produces valid creatures
 * when using shallowClone instead of JSON round-trip cloning.
 *
 * Issue #1474: Reduce serialisation overhead in evolution loop.
 *
 * Seeds use explicit 4.x forward-only semantics; breeding uses
 * `prepareCreatureForBreeding` so parents are not run through the legacy
 * upgrade pipeline when already modern.
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

Deno.test("populatePopulation: clones validate correctly", async () => {
  const dataDir = createTestDataDir(5, 3);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 12,
    };

    const neat = new Neat(5, 3, options, workers);
    const seedCreature = new Creature(5, 3, {
      layers: [{ count: 8 }, { count: 4 }],
    });

    neat.populatePopulation(seedCreature);

    // Every creature in the population should pass validation
    for (let i = 0; i < neat.population.length; i++) {
      creatureValidate(neat.population[i]);
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: clones can be exported and re-imported", async () => {
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 8,
    };

    const neat = new Neat(3, 2, options, workers);
    const seedCreature = new Creature(3, 2, {
      layers: [{ count: 5 }],
    });

    neat.populatePopulation(seedCreature);

    // Every creature should be serialisable and deserialisable
    for (const creature of neat.population) {
      const exported = creature.exportJSON();
      const reimported = Creature.fromJSON(exported);

      assertEquals(reimported.input, creature.input);
      assertEquals(reimported.output, creature.output);
      assertEquals(reimported.neurons.length, creature.neurons.length);
      assertEquals(reimported.synapses.length, creature.synapses.length);
      try {
        creatureValidate(reimported);
      } catch {
        reimported.fix();
        creatureValidate(reimported);
      }
    }
  } finally {
    await terminateWorkers(workers);
  }
});

Deno.test("populatePopulation: clones are independent of seed creature", async () => {
  const dataDir = createTestDataDir(3, 2);
  const workers = createTestWorkers(dataDir);

  try {
    const options: NeatOptions = {
      populationSize: 6,
    };

    const neat = new Neat(3, 2, options, workers);
    const seedCreature = new Creature(3, 2, {
      layers: [{ count: 4 }],
    });

    neat.populatePopulation(seedCreature);

    // Modify the seed creature's bias — clones should be unaffected
    const originalBiases = neat.population.slice(1).map((c) => {
      const hiddenNeurons = c.neurons.filter((n) => n.type === "hidden");
      return hiddenNeurons.map((n) => n.bias);
    });

    // Mutate the seed creature's hidden neuron biases
    for (const n of seedCreature.neurons) {
      if (n.type === "hidden") {
        n.bias += 999;
      }
    }

    // Verify clones were not affected
    for (let i = 0; i < neat.population.length - 1; i++) {
      const creature = neat.population[i + 1];
      const hiddenNeurons = creature.neurons.filter((n) => n.type === "hidden");
      const biases = hiddenNeurons.map((n) => n.bias);
      assertEquals(
        biases,
        originalBiases[i],
        `Clone ${i} biases should not be affected by seed mutation`,
      );
    }
  } finally {
    await terminateWorkers(workers);
  }
});
