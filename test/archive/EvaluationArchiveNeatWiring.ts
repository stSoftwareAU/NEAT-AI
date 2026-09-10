/**
 * `NeatOptions.evaluationArchive` reaching the fitness path (Issue #3929).
 *
 * The archive is opt-in run infrastructure, so the seam that matters is
 * config → `Neat` → `Fitness`: asking for it must produce a real archive that
 * the evaluation path writes to, and *not* asking for it must construct
 * nothing and touch no disk.
 */

import { assert, assertEquals } from "@std/assert";
import { Neat } from "@neat/Neat.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { readEvaluationArchive } from "@archive/EvaluationArchive.ts";
import {
  buildForwardOnlyPopulation,
  MockWorkerHandler,
} from "../score/_racingFixtures.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("evaluation archive — Neat builds no archive unless asked", async () => {
  const directory = await Deno.makeTempDir({ prefix: "neat-archive-off-" });
  try {
    const neat = new Neat(2, 1, { populationSize: 4 }, []);
    assertEquals(neat.evaluationArchive, undefined);

    // Nothing may be written to the default location either.
    const entries = [...Deno.readDirSync(directory)];
    assertEquals(entries.length, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — an enabled archive is written by the fitness path", async () => {
  await initWasmForTests();
  const directory = await Deno.makeTempDir({ prefix: "neat-archive-on-" });
  const worker = new MockWorkerHandler();
  try {
    const neat = new Neat(
      2,
      1,
      {
        populationSize: 4,
        evaluationArchive: {
          enabled: true,
          directory,
          runId: "wiring-run",
        },
      },
      [worker as unknown as WorkerHandler],
    );
    const archive = neat.evaluationArchive;
    assert(archive !== undefined, "an enabled archive must exist");

    // Two generations, so the generation stamp is observably per-generation
    // rather than a constant.
    archive.beginGeneration(1);
    await neat.fitness.calculate(buildForwardOnlyPopulation(3));
    archive.beginGeneration(2);
    await neat.fitness.calculate(buildForwardOnlyPopulation(2));

    const records = await readEvaluationArchive(archive.path);
    assertEquals(records.length, 5);
    assertEquals(records.map((r) => r.generation), [1, 1, 1, 2, 2]);
    for (const record of records) {
      assertEquals(record.runId, "wiring-run");
      assertEquals(record.fidelity, 1);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
