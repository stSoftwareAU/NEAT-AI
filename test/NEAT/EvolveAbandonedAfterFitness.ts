/**
 * Regression test for Issue #4052 (part B): a generation abandoned by the
 * hard deadline while its fitness phase is in flight must not go on to
 * reorder `neat.population` once fitness returns. `BoundedEvolveTeardown`'s
 * checkpoint write iterates the same array, so an in-place re-sort from the
 * background generation made the checkpoint duplicate some members and drop
 * others.
 *
 * Each test starts `neat.evolve()` without awaiting it and abandons the run
 * straight away (deterministic: `evolve()` runs up to its first real await
 * before the abandon line executes, and fitness is a real await). The
 * `Date.now()` used here only supplies an arbitrary past instant for the
 * required `hardDeadlineMS` argument, not a timing assertion.
 */

import { assert, assertEquals } from "@std/assert";
import { addTag, getTag, type TagsInterface } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { writeCreatures } from "@creature/CheckpointWriter.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

function createTestDataDir(input: number, output: number): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 20; i++) {
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

async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
}

/**
 * Build a populated Neat whose members already carry distinct, ascending
 * scores. `Fitness.calculate` leaves scored creatures alone, so the
 * population order (ascending) is the exact opposite of the best-first order
 * `sortCreaturesByScore` would impose — a re-sort is therefore detectable.
 */
async function buildScoredNeat(workers: WorkerHandler[]): Promise<Neat> {
  const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const options: NeatOptions = {
    creatures: [seedCreature.exportJSON()],
    populationSize: 10,
  };
  const neat = new Neat(2, 1, options, workers);
  await neat.populatePopulation(seedCreature);
  neat.population.forEach((creature, indx) => {
    creature.score = indx;
    addTag(creature, "score", indx.toString());
    addTag(creature, "error", (1 - indx / 10).toString());
  });
  return neat;
}

/** A scored champion handed to `evolve()` as the read-only previous fittest. */
function previousFittest(): Creature {
  const champion = new Creature(2, 1, { layers: [{ count: 3 }] });
  champion.score = 0.5;
  addTag(champion, "score", "0.5");
  addTag(champion, "error", "0.5");
  return champion;
}

Deno.test(
  "evolve: a generation abandoned during fitness leaves neat.population " +
    "in its original order (Issue #4052)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(2, 1), "MSE", true)];
    try {
      const neat = await buildScoredNeat(workers);
      const before = [...neat.population];
      const completedBefore = neat.generationsCompleted;

      const evolvePromise = neat.evolve(previousFittest());
      neat.generationsCompleted = 1;
      assert(
        neat.abandonInFlightPastHardDeadline(Date.now() - 1000),
        "the hard-deadline abandon must actually fire",
      );
      await evolvePromise;

      // Members are structural clones with identical uuids, so identity is
      // by object reference.
      assertEquals(
        neat.population.length,
        before.length,
        "an abandoned generation must not change membership",
      );
      assert(
        neat.population.every((c, indx) => c === before[indx]),
        "an abandoned generation must not re-sort neat.population",
      );
      assertEquals(
        neat.generationsCompleted,
        completedBefore + 1,
        "an abandoned generation must not bank itself as completed",
      );
    } finally {
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: a checkpoint written while an abandoned generation finishes " +
    "holds every member exactly once (Issue #4052)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(2, 1), "MSE", true)];
    const outDir = await Deno.makeTempDir();
    try {
      const neat = await buildScoredNeat(workers);
      // Members are structural clones sharing one uuid; the distinct "score"
      // tag set in buildScoredNeat identifies each.
      const expected = neat.population.map((c) => getTag(c, "score")).sort();

      const evolvePromise = neat.evolve(previousFittest());
      neat.generationsCompleted = 1;
      assert(neat.abandonInFlightPastHardDeadline(Date.now() - 1000));

      // Each write yields a macrotask so the background generation can
      // finish mid-checkpoint.
      const written: string[] = [];
      await writeCreatures(neat, `${outDir}/cp`, {
        batchSize: 2,
        writeTextFile: async (_path: string, text: string) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          written.push(
            String(getTag(JSON.parse(text) as TagsInterface, "score")),
          );
        },
      });
      await evolvePromise;

      assertEquals(
        written.slice().sort(),
        expected,
        "every original member must be checkpointed exactly once",
      );
    } finally {
      await terminateWorkers(workers);
      await Deno.remove(outDir, { recursive: true });
    }
  },
);
