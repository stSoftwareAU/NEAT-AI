/**
 * Issue #4096: the "breeding" watchdog marker used to cover parent selection,
 * result processing and offspring handling, so a breach line reading
 * `inFlightPhase=breeding` could not say which one blocked. One real evolve()
 * generation must now announce each piece under its own name, in order.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import { evolve } from "../../src/NEAT/NeatEvolution.ts";
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

Deno.test(
  "evolve: breeding is announced as parent-selection, result-processing, breeding, then mutation (Issue #4096)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    try {
      const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
      const neat = new Neat(2, 1, {
        creatures: [seedCreature.exportJSON()],
        populationSize: 10,
        elitism: 2,
      } as NeatOptions, workers);
      await neat.populatePopulation(seedCreature);

      const received: string[] = [];
      neat.setPhaseObserver((phase) => received.push(phase));

      await evolve(neat);

      const order = [
        "parent-selection",
        "result-processing",
        "breeding",
        "mutation",
      ].map((name) => {
        const index = received.indexOf(name);
        assert(index >= 0, `phase ${name} was never announced: ${received}`);
        return index;
      });
      for (let i = 1; i < order.length; i++) {
        assert(
          order[i] > order[i - 1],
          `phases out of order: ${received.join(",")}`,
        );
      }
      assertEquals(
        received[received.indexOf("result-processing") + 1],
        "breeding",
        "breeding must follow result-processing directly",
      );
    } finally {
      await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
      for (const w of workers) w.terminate();
    }
  },
);
