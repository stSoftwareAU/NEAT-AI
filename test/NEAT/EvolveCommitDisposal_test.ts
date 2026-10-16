/**
 * Issue #4061: a generation that commits normally (it was not abandoned past
 * the hard deadline) still releases what it no longer needs. Previous
 * population members that were not carried forward are disposed, members that
 * were carried forward stay intact, and creatures the population budget
 * dropped are disposed too (Issues #1568, #3508).
 *
 * The heavy-pool results are stubbed, as in `PopulationBudgetEvolve.ts`, so
 * the budget is guaranteed to overflow and drop some of them.
 */

import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import { evolve } from "../../src/NEAT/NeatEvolution.ts";
import type { ResponseData } from "../../src/multithreading/workers/WorkerHandler.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";

function createTestDataDir(): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 20; i++) {
    records.push({
      input: new Float32Array([Math.random(), Math.random()]),
      output: new Float32Array([Math.random()]),
    });
  }
  return makeDataDir(records, 2000);
}

/**
 * A completed training result carrying four creature variants. The uuid of
 * every variant is recorded, so the test can find each one again after the
 * commit whether it was kept or dropped.
 */
function makeTrainingResult(id: string, uuids: Set<string>): ResponseData {
  const variant = () => {
    const exported = new Creature(2, 1, { layers: [{ count: 3 }] })
      .exportJSON();
    uuids.add(CreatureUtil.makeUUID(Creature.fromJSON(exported)));
    return exported;
  };
  const compact = variant();
  addTag(compact, "old-neurons", "5");

  return {
    taskID: 1,
    duration: 1,
    train: {
      ID: id,
      creature: variant(),
      error: 0.1,
      compact,
      backtracked: variant(),
      forward: variant(),
    },
  } as unknown as ResponseData;
}

Deno.test("evolve: a committed generation disposes the members it drops and keeps the ones it carries forward", async () => {
  const dataDir = createTestDataDir();
  const workers = [new WorkerHandler(dataDir, "MSE", true)];
  const originalDispose = Creature.prototype.dispose;

  try {
    const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
    const neat = new Neat(2, 1, {
      creatures: [seedCreature.exportJSON()],
      populationSize: 10,
      elitism: 2,
    } as NeatOptions, workers);
    await neat.populatePopulation(seedCreature);

    // Four completed training tasks → 16 creatures on a budget of 10.
    const injected = new Set<string>();
    for (let task = 0; task < 4; task++) {
      neat.trainingComplete.push(makeTrainingResult(`task${task}`, injected));
    }

    // Record the uuid of every creature disposed while it still had a genome.
    const disposedUuids = new Set<string>();
    Creature.prototype.dispose = function (this: Creature) {
      if (this.neurons.length > 0) {
        disposedUuids.add(CreatureUtil.makeUUID(this));
      }
      return originalDispose.call(this);
    };

    const previousMembers = [...neat.population];
    await evolve(neat);
    Creature.prototype.dispose = originalDispose;

    const committed = new Set(neat.population);
    const dropped = previousMembers.filter((member) => !committed.has(member));
    const carried = previousMembers.filter((member) => committed.has(member));
    assert(dropped.length > 0, "some previous members must be dropped");
    assert(carried.length > 0, "the elites must be carried forward");

    dropped.forEach((member, index) => {
      assert(
        member.neurons.length === 0,
        `dropped previous member ${index} was not disposed (neurons: ${member.neurons.length})`,
      );
    });
    neat.population.forEach((member, index) => {
      assert(
        member.neurons.length >= member.input + member.output,
        `population member ${index} was disposed by the commit (neurons: ${member.neurons.length})`,
      );
    });

    const keptUuids = new Set(
      neat.population.map((member) => CreatureUtil.makeUUID(member)),
    );
    const budgetDropped = [...injected].filter((uuid) => !keptUuids.has(uuid));
    assert(
      budgetDropped.length > 0,
      "the population budget must drop some of the stubbed results",
    );
    for (const uuid of budgetDropped) {
      assert(
        disposedUuids.has(uuid),
        `a creature the population budget dropped was not disposed (${uuid})`,
      );
    }
  } finally {
    Creature.prototype.dispose = originalDispose;
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const w of workers) {
      w.terminate();
    }
  }
});
