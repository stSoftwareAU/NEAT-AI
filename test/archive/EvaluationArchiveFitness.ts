/**
 * The evaluation archive wired through `Fitness.calculate` (Issue #3929).
 *
 * The archive earns its keep on the **true-evaluation path**, so these tests
 * drive the real fitness loop — the per-creature worker path and the native
 * batch path with racing on — and read the archive file back. What is asserted
 * is the outcome: which evaluations are kept, which are deliberately not, and
 * that none of it reaches the creature export.
 */

import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Fitness } from "@architecture/Fitness.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { resolveEvaluationArchiveConfig } from "@config/EvaluationArchiveConfig.ts";
import { resolveRacingConfig } from "@config/RacingConfig.ts";
import { EvaluationArchive } from "@archive/EvaluationArchive.ts";
import { readEvaluationArchive } from "@archive/EvaluationArchiveFormat.ts";
import { EVALUATION_DESCRIPTOR_LENGTH } from "@archive/EvaluationDescriptor.ts";
import {
  __resetRacingSessionRunner,
  __setRacingSessionRunnerForTests,
  type RacingSessionRequest,
} from "../../src/score/RacingScorerSession.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import {
  buildDataSet,
  buildForwardOnlyPopulation,
  errorsFor,
  HELP_WITH_RACING,
  MockWorkerHandler,
  racingSession,
  stubRunner,
} from "../score/_racingFixtures.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** An archive under a fresh temporary directory, plus that directory. */
async function makeArchive(): Promise<
  { archive: EvaluationArchive; directory: string }
> {
  const directory = await Deno.makeTempDir({ prefix: "neat-archive-fitness-" });
  return {
    archive: new EvaluationArchive(
      resolveEvaluationArchiveConfig({
        enabled: true,
        directory,
        runId: "fitness-run",
      }),
    ),
    directory,
  };
}

Deno.test("evaluation archive — off by default, so no archive is configured", () => {
  const config = createNeatConfig({});
  assertEquals(config.evaluationArchive.enabled, false);
  assertEquals(config.evaluationArchive.maxRecords, 100_000);
});

Deno.test("evaluation archive — the per-creature path archives every exact score", async () => {
  await initWasmForTests();
  const { archive, directory } = await makeArchive();
  const worker = new MockWorkerHandler();
  try {
    const fitness = new Fitness([worker as unknown as WorkerHandler], 0, false);
    fitness.setEvaluationArchive(archive);
    archive.beginGeneration(3);

    const population = buildForwardOnlyPopulation(4);
    await fitness.calculate(population);

    const records = await readEvaluationArchive(archive.path);
    assertEquals(records.length, population.length);
    assertEquals(
      records.map((r) => r.uuid).sort(),
      population.map((c) => c.uuid!).sort(),
    );
    for (const record of records) {
      assertEquals(record.fidelity, 1, "only exact scores are archived");
      assertEquals(record.generation, 3);
      assertEquals(record.runId, "fitness-run");
      assertEquals(record.descriptor.length, EVALUATION_DESCRIPTOR_LENGTH);
    }
    // The archived score is the score the creature actually carries.
    for (const creature of population) {
      const record = records.find((r) => r.uuid === creature.uuid)!;
      assertEquals(record.score, creature.score);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — a de-duplicated creature is archived once, not twice", async () => {
  await initWasmForTests();
  const { archive, directory } = await makeArchive();
  const worker = new MockWorkerHandler();
  try {
    const fitness = new Fitness([worker as unknown as WorkerHandler], 0, false);
    fitness.setEvaluationArchive(archive);

    const [original] = buildForwardOnlyPopulation(1);
    const [twin] = buildForwardOnlyPopulation(1);
    assertEquals(
      twin.uuid,
      original.uuid,
      "the fixtures really are duplicates",
    );
    await fitness.calculate([original, twin]);

    const records = await readEvaluationArchive(archive.path);
    assertEquals(
      records.length,
      1,
      "the archive records true evaluations, not score fan-out",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — a racing-abandoned partial score is never archived", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  __resetRacingSessionRunner();
  __setRustScorerConfigForTests({ enabled: true, batch: true });

  const { archive, directory } = await makeArchive();
  const dataDir = makeDataDir(buildDataSet(), 4);
  const worker = new MockWorkerHandler();
  try {
    const fitness = new Fitness(
      [worker as unknown as WorkerHandler],
      0.0001,
      false,
      undefined,
      dataDir,
      "MSE",
      undefined,
      false,
      undefined,
      resolveRacingConfig({ enabled: true }),
    );
    fitness.setEvaluationArchive(archive);

    // Generation 1 — a full sweep; this is where the corpus size is learnt.
    const first = buildForwardOnlyPopulation(3);
    const firstErrors = errorsFor(first, [0.05, 0.06, 0.07]);
    __setRustScorerRunnerForTests(stubRunner(HELP_WITH_RACING, firstErrors));
    const observed = { requests: [] as RacingSessionRequest[] };
    __setRacingSessionRunnerForTests(racingSession(firstErrors, observed));
    archive.beginGeneration(1);
    await fitness.calculate(first);

    // Generation 2 — two hopeless offspring are abandoned mid-corpus.
    const second = buildForwardOnlyPopulation(4);
    const secondErrors = errorsFor(second, [0.05, 0.08, 0.9, 0.95]);
    __setRustScorerRunnerForTests(stubRunner(HELP_WITH_RACING, secondErrors));
    __setRacingSessionRunnerForTests(racingSession(secondErrors, observed));
    archive.beginGeneration(2);
    await fitness.calculate(second);

    assertEquals(fitness.lastRacingSummary!.abandoned, 2);
    const abandoned = second.filter((c) => Boolean(getTag(c, "racing")));
    assertEquals(abandoned.length, 2);

    const records = await readEvaluationArchive(archive.path);
    const archivedInGeneration2 = records.filter((r) => r.generation === 2);
    assertEquals(
      archivedInGeneration2.length,
      2,
      "only the two fully-scored creatures are ground truth",
    );
    for (const creature of abandoned) {
      assert(
        !archivedInGeneration2.some((r) => r.uuid === creature.uuid),
        `abandoned creature ${creature.uuid} must not be archived as truth`,
      );
    }
    for (const record of records) assertEquals(record.fidelity, 1);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    await Deno.remove(directory, { recursive: true });
    __resetRustScorerBridgeForTests();
    __resetRacingSessionRunner();
  }
});

Deno.test("evaluation archive — nothing it records reaches the creature export", async () => {
  await initWasmForTests();
  const { archive, directory } = await makeArchive();
  const worker = new MockWorkerHandler();
  try {
    const fitness = new Fitness([worker as unknown as WorkerHandler], 0, false);
    fitness.setEvaluationArchive(archive);
    archive.beginGeneration(5);

    const population = buildForwardOnlyPopulation(2);
    const uuidsBefore = population.map((c) => c.uuid);
    await fitness.calculate(population);

    const records = await readEvaluationArchive(archive.path);
    assertEquals(records.length, 2, "the archive really did write");

    for (const creature of population) {
      const exported = creature.exportJSON();
      const text = JSON.stringify(exported);
      for (
        const leaked of [
          "descriptor",
          "descriptorVersion",
          "fidelity",
          "runId",
          "recordedAt",
          "fitness-run",
        ]
      ) {
        assert(
          !text.includes(leaked),
          `"${leaked}" leaked into the creature export: ${text}`,
        );
      }
      for (const tag of ["descriptor", "fidelity", "runId", "parents"]) {
        assert(
          !getTag(creature, tag),
          `the archive must not tag the creature with "${tag}"`,
        );
      }
    }

    // The export is content-addressed: archiving must not have moved identity.
    assertEquals(population.map((c) => c.uuid), uuidsBefore);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
