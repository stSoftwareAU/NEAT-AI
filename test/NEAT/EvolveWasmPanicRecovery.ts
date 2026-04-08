/**
 * Tests verifying that the evolution loop handles creatures with -Infinity
 * scores gracefully.
 *
 * Issue #2214: When WASM panics with "RuntimeError: unreachable" (e.g. under
 * memory pressure), the Fitness processor assigns -Infinity scores to the
 * affected creatures (Issue #2211). The evolution loop must skip these
 * creatures from the genus rather than crashing with an assertion failure.
 */
import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

function createTestDataDir(): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 20; i++) {
    records.push({
      input: new Float32Array(
        Array.from({ length: 2 }, () => Math.random()),
      ),
      output: new Float32Array(
        Array.from({ length: 1 }, () => Math.random()),
      ),
    });
  }
  return makeDataDir(records, 2000);
}

Deno.test("evolve: creatures with -Infinity score are excluded from genus without crashing", async () => {
  const dataDir = createTestDataDir();
  const workers = [new WorkerHandler(dataDir, "MSE", true)];

  try {
    await Promise.all(workers.map((w) => w.waitUntilReady()));

    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    // Evaluate the population to get real scores.
    await neat.fitness.calculate(neat.population);

    // Simulate what Fitness.ts does after a WASM panic (Issue #2211):
    // assign -Infinity score to some creatures in the population.
    // Set the worst-scoring creatures to -Infinity (mimicking partial WASM
    // failures under memory pressure).
    const panicCount = Math.min(3, neat.population.length);
    for (
      let i = neat.population.length - panicCount;
      i < neat.population.length;
      i++
    ) {
      neat.population[i].score = -Infinity;
      addTag(neat.population[i], "error", "Infinity");
      addTag(neat.population[i], "score", "-Infinity");
    }

    // evolve() should NOT throw — creatures with -Infinity score should be
    // skipped from the genus, not cause an assertion failure.
    const { fittest } = await neat.evolve();

    assert(fittest, "Evolution should return a fittest creature");
    assert(fittest.uuid, "Fittest should have a UUID");
    assert(
      Number.isFinite(fittest.score),
      "Fittest creature should have a finite score",
    );
  } finally {
    for (const w of workers) {
      w.terminate();
    }
  }
});

Deno.test("evolve: majority of creatures with -Infinity score still evolves", async () => {
  const dataDir = createTestDataDir();
  const workers = [new WorkerHandler(dataDir, "MSE", true)];

  try {
    await Promise.all(workers.map((w) => w.waitUntilReady()));

    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
    };

    const neat = new Neat(2, 1, options, workers);
    neat.populatePopulation(seedCreature);

    // Calculate real scores first so the population is valid.
    await neat.fitness.calculate(neat.population);

    // Set most creatures to -Infinity, leaving only 2 with valid scores.
    // This tests the case where memory pressure kills most evaluations.
    for (let i = 2; i < neat.population.length; i++) {
      neat.population[i].score = -Infinity;
      addTag(neat.population[i], "error", "Infinity");
      addTag(neat.population[i], "score", "-Infinity");
    }

    // evolve() should still not throw — the genus has at least some creatures.
    const { fittest } = await neat.evolve();

    assert(fittest, "Evolution should still return a fittest creature");
    assert(fittest.uuid, "Fittest should have a UUID");
    assert(
      Number.isFinite(fittest.score),
      "Fittest creature should have a finite score",
    );
  } finally {
    for (const w of workers) {
      w.terminate();
    }
  }
});
