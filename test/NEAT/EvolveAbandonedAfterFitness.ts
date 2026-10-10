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
 * `hardDeadlineMS` argument is a fixed, arbitrary past instant (no timing API
 * is used).
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

/** A fixed epoch-ms instant that is always in the past. */
const PAST_HARD_DEADLINE_MS = 1_000;

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

      const evolvePromise = neat.evolve(previousFittest());
      neat.generationsCompleted = 1;
      assert(
        neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS),
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
        1,
        "an abandoned generation must not bank itself as completed " +
          "(only the generation the test marked complete is counted)",
      );
    } finally {
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: a generation abandoned during fitness still returns the real " +
    "champion and averages, from a sorted copy (Issue #4052)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(2, 1), "MSE", true)];
    try {
      const neat = await buildScoredNeat(workers);
      const before = [...neat.population];
      // Scores are 0..9 in ascending order, so the best member is the last
      // one and the first member (the old placeholder) is the worst.
      const best = before[before.length - 1];

      const evolvePromise = neat.evolve(previousFittest());
      neat.generationsCompleted = 1;
      assert(neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS));
      const result = await evolvePromise;

      assertEquals(result.fittest.score, best.score, "champion is not lost");
      assertEquals(getTag(result.fittest, "score"), String(best.score));
      assertEquals(result.averageScore, 4.5, "average is the real mean");
      assert(
        result.topologyAverages.averageNeurons > 0 &&
          result.topologyAverages.averageSynapses > 0,
        "topology telemetry is the real population's",
      );
      assert(
        neat.population.every((c, indx) => c === before[indx]),
        "the live population is still untouched",
      );
    } finally {
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: an abandoned generation keeps a previous champion that beats " +
    "the population (Issue #4052)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(2, 1), "MSE", true)];
    try {
      const neat = await buildScoredNeat(workers);
      const champion = previousFittest();
      champion.score = 100;
      addTag(champion, "score", "100");

      const evolvePromise = neat.evolve(champion);
      neat.generationsCompleted = 1;
      assert(neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS));
      const result = await evolvePromise;

      assertEquals(result.fittest.score, 100);
      assertEquals(result.fittest.uuid, champion.uuid);
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

      // The abandoned generation runs to completion *between* checkpoint
      // batches: on the first write only, start evolve(), abandon it, and
      // wait for it. Without the early return it re-sorts neat.population in
      // place here, after batch one has been read and before batch two.
      let evolveRan = false;
      const written: string[] = [];
      await writeCreatures(neat, `${outDir}/cp`, {
        batchSize: 2,
        writeTextFile: async (_path: string, text: string) => {
          if (!evolveRan) {
            evolveRan = true;
            const evolvePromise = neat.evolve(previousFittest());
            neat.generationsCompleted = 1;
            assert(neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS));
            await evolvePromise;
          }
          written.push(
            String(getTag(JSON.parse(text) as TagsInterface, "score")),
          );
        },
      });

      assert(evolveRan, "the abandoned generation must run mid-checkpoint");
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
