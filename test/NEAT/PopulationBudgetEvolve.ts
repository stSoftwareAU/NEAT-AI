/**
 * Issue #3508: the assembled population must never exceed the effective
 * population size, even when a burst of heavy-pool training results lands in
 * a single generation.
 *
 * Each completed training task can contribute up to four creatures (trained,
 * backtracked, forward and compact), and the bred slice is budgeted *before*
 * those results are drained — so an unbudgeted burst previously inflated the
 * population, and therefore the next generation's fitness queue.
 */

import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

function createTestDataDir(input: number, output: number, count = 20): string {
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

/** A completed training result carrying four creature variants. */
function makeTrainingResult(id: string): ResponseData {
  const variant = () =>
    new Creature(2, 1, { layers: [{ count: 3 }] }).exportJSON();

  // The compact variant carries the neuron count the real worker records, so
  // approach logging has the tag it expects if it becomes the fittest.
  const compact = variant();
  addTag(compact, "old-neurons", "5");

  return {
    taskID: 1,
    duration: 1,
    train: {
      ID: id,
      creature: variant(),
      error: 0.1,
      trace: variant(),
      compact,
      backtracked: variant(),
      forward: variant(),
    },
  } as unknown as ResponseData;
}

Deno.test("evolve: a heavy-pool burst never grows the population beyond the effective size", async () => {
  const dataDir = createTestDataDir(2, 1);
  const workers = [new WorkerHandler(dataDir, "MSE", true)];

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const options: NeatOptions = {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
      elitism: 2,
    };

    const neat = new Neat(2, 1, options, workers);
    await neat.populatePopulation(seedCreature);

    let previousFittest: Creature | undefined;
    for (let generation = 0; generation < 3; generation++) {
      // Four completed training tasks → up to 16 unbudgeted creatures.
      const injectedIDs = new Set<string>();
      for (let task = 0; task < 4; task++) {
        const id = `gen${generation}-task${task}`;
        injectedIDs.add(id);
        neat.trainingComplete.push(makeTrainingResult(id));
      }

      // deno-lint-ignore no-await-in-loop -- generations are sequential
      const result = await neat.evolve(previousFittest);
      previousFittest = result.fittest;

      // Real training tasks may complete during evolve, so only assert that
      // the injected burst itself was drained into the population.
      assert(
        !neat.trainingComplete.some((r) =>
          r.train !== undefined && injectedIDs.has(r.train.ID)
        ),
        "Injected training results should have been drained into the population",
      );
      assert(
        neat.population.length <= neat.effectivePopulationSize,
        `Generation ${generation}: population of ${neat.population.length} ` +
          `exceeds the effective size of ${neat.effectivePopulationSize}`,
      );
    }
  } finally {
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const w of workers) {
      w.terminate();
    }
  }
});
