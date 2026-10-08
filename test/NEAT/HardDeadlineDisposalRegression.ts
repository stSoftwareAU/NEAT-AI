/**
 * Regression test for Issue #4050: a generation abandoned mid-flight by the
 * hard deadline must not commit its population swap or dispose any previous
 * member — `BoundedEvolveTeardown`'s checkpoint write may already be
 * exporting `neat.population` by the time the abandoned `evolve()` resumes
 * (PR #4051 review). Disposing a member that write is still iterating is
 * what produced `RangeError: Invalid array length` in
 * `CreatureExportBuilder.build()`.
 *
 * The previous version of this test called `evolveDir` with an injected
 * clock, asserted `assert(true)` after swallowing every error, and could not
 * fail: generation 1 ran uncapped (`generationCap` is always `0` for the
 * first generation) and the injected clock jumped far past the hard deadline
 * before generation 2 even started, so the race was never exercised, and the
 * same `assert(true)` would have passed unmodified on Develop too.
 *
 * This version abandons the run *while* `neat.evolve()` is actually
 * in-flight: `evolve()` is invoked but not yet awaited, the abandon fires
 * synchronously straight after (deterministic — JS runs `evolve()`'s body up
 * to its first real `await` before this line executes, and every generation
 * does several real awaits — fitness evaluation, dedup I/O — before the
 * population commit this issue is about), and only then is the promise
 * awaited. No real clock delay is needed: `Date.now()` here only picks an
 * arbitrary past instant for the required `hardDeadlineMS` argument (the
 * same idiom `NeatAbandonLateCompletion.ts` uses), not a timing assertion.
 */

import { assert, assertStrictEquals } from "@std/assert";
import { Creature } from "@creature";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { Neat } from "@neat/Neat.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
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

function createTestWorkers(dataDir: string): WorkerHandler[] {
  return [new WorkerHandler(dataDir, "MSE", true)];
}

async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
}

Deno.test(
  "evolve: a generation abandoned past the hard deadline does not swap " +
    "neat.population or dispose any previous member (Issue #4050)",
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
      await neat.populatePopulation(seedCreature);

      // Keep the exact array reference — not a copy — so a swap is
      // detectable by identity, the same thing a concurrent checkpoint
      // write would be holding onto.
      const originalPopulationRef = neat.population;
      const originalMembers = [...originalPopulationRef];

      // Start the generation, then abandon it before awaiting it: this
      // reproduces a hard-deadline breach firing while the generation is
      // in flight, which is exactly what BoundedEvolveTeardown's watchdog
      // does in production (awaitWithinHardDeadline's onBreach callback).
      const evolvePromise = neat.evolve();
      neat.generationsCompleted = 1;
      const abandoned = neat.abandonInFlightPastHardDeadline(
        Date.now() - 1000,
      );
      assert(abandoned, "the hard-deadline abandon must actually fire");

      await evolvePromise;

      // The abandoned generation must leave neat.population exactly as it
      // found it — not swapped to a new array — and must not have disposed
      // any member of the previous population, which a concurrent
      // checkpoint write could still be exporting.
      assertStrictEquals(
        neat.population,
        originalPopulationRef,
        "an abandoned generation must not commit a population swap",
      );
      for (const creature of originalMembers) {
        assert(
          creature.neurons.length > 0,
          "an abandoned generation must not dispose a previous population member",
        );
      }
    } finally {
      await terminateWorkers(workers);
    }
  },
);
