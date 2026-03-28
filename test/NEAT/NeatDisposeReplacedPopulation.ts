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
 * Unit tests for Issue #1568: Explicitly dispose replaced population
 * creatures after each generation.
 *
 * Verifies that old population creatures are disposed when replaced,
 * while elitists and carried-forward creatures are not disposed.
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

/** Verify that replaced creatures are disposed and carried-forward ones are intact. */
function verifyDisposal(
  oldPopulation: Creature[],
  newPopulation: Creature[],
  gen: number,
): void {
  const newPopulationSet = new Set(newPopulation);

  for (const oldCreature of oldPopulation) {
    if (!newPopulationSet.has(oldCreature)) {
      assertEquals(
        oldCreature.neurons.length,
        0,
        `Generation ${gen}: disposed creature should have empty neurons`,
      );
      assertEquals(
        oldCreature.synapses.length,
        0,
        `Generation ${gen}: disposed creature should have empty synapses`,
      );
    }
  }

  for (const creature of newPopulation) {
    assert(
      creature.neurons.length > 0,
      `Generation ${gen}: population creatures should have neurons`,
    );
  }
}

Deno.test(
  "evolve: old population creatures are disposed after replacement",
  async () => {
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

      // Activate all creatures to ensure they have cached WASM state
      const testInput = new Float32Array([0.5, 0.5]);
      for (const creature of neat.population) {
        creature.activate(testInput);
      }

      // Verify WASM state is cached before evolution
      const creaturesWithWasm = neat.population.filter(
        (c) => c.cachedWasmActivation !== undefined,
      );
      assert(
        creaturesWithWasm.length > 0,
        "Some creatures should have cached WASM before evolution",
      );

      // Save references to old population creatures
      const oldPopulation = [...neat.population];

      await neat.evolve();

      // Build set of creatures that are in the new population
      const newPopulationSet = new Set(neat.population);

      // Old creatures NOT in the new population should be disposed
      // (their neurons and synapses arrays should be empty)
      let disposedCount = 0;
      for (const oldCreature of oldPopulation) {
        if (!newPopulationSet.has(oldCreature)) {
          assertEquals(
            oldCreature.neurons.length,
            0,
            "Disposed creature should have empty neurons array",
          );
          assertEquals(
            oldCreature.synapses.length,
            0,
            "Disposed creature should have empty synapses array",
          );
          assertEquals(
            oldCreature.cachedWasmActivation,
            undefined,
            "Disposed creature should not have cached WASM",
          );
          disposedCount++;
        }
      }

      assert(
        disposedCount > 0,
        "At least some old creatures should have been disposed",
      );
    } finally {
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: elitists are not disposed when carried forward",
  async () => {
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

      await neat.evolve();

      // Elitists should be in the new population and still have their
      // neurons and synapses intact
      for (const creature of neat.population) {
        assert(
          creature.neurons.length > 0,
          "Carried-forward creatures should have neurons",
        );
        assert(
          creature.synapses.length > 0,
          "Carried-forward creatures should have synapses",
        );
      }
    } finally {
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: WASM is freed deterministically on replaced creatures",
  async () => {
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

      // Activate all creatures to create WASM state
      const testInput = new Float32Array([0.5, 0.5]);
      for (const creature of neat.population) {
        creature.activate(testInput);
      }

      // Save references to old population
      const oldPopulation = [...neat.population];

      await neat.evolve();

      // Build set of creatures that are in the new population
      const newPopulationSet = new Set(neat.population);

      // Verify ALL replaced creatures have had their WASM freed
      for (const oldCreature of oldPopulation) {
        if (!newPopulationSet.has(oldCreature)) {
          assertEquals(
            oldCreature.cachedWasmActivation,
            undefined,
            "Replaced creature should have WASM freed deterministically",
          );
        }
      }
    } finally {
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: multiple generations dispose correctly each time",
  async () => {
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

      // Run 3 sequential generations, verifying disposal each time.
      // Each generation depends on the previous, so we run them sequentially.
      const gen0Old = [...neat.population];
      const result0 = await neat.evolve();
      verifyDisposal(gen0Old, neat.population, 0);

      const gen1Old = [...neat.population];
      const result1 = await neat.evolve(result0.fittest);
      verifyDisposal(gen1Old, neat.population, 1);

      const gen2Old = [...neat.population];
      await neat.evolve(result1.fittest);
      verifyDisposal(gen2Old, neat.population, 2);
    } finally {
      await terminateWorkers(workers);
    }
  },
);
