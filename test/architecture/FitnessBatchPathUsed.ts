/**
 * Permanent assertion: a `forwardOnly` population is scored via the Rust
 * **batch** path — one `rust_scorer` invocation per generation — not the slow
 * per-creature worker path (Issue #3237, parent #3233).
 *
 * `Fitness.calculate()` partitions each generation: `forwardOnly` creatures go
 * through `tryBatchScoreWithRustScorer` (one process per generation) while
 * recurrent creatures take the per-creature worker path. This test drives an
 * all-`forwardOnly` population through several generations, accumulating each
 * generation's per-backend counts into the run-level
 * {@link ScorerUtilisationTotals} — the exact telemetry surfaced on the
 * `evolve*` result and in the production run's `result.json`.
 *
 * It fails if the batch path silently stops being used (regression to
 * per-creature scoring): `batchScorerInvocations` would drop below the
 * generation count and `creaturesBatchScored` would fall to zero while
 * `creaturesPerCreatureScored` absorbed the load.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  accumulateScorerUtilisation,
  createScorerUtilisationAccumulator,
  finaliseScorerUtilisationTotals,
} from "@creature/ScorerUtilisationTotals.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Records how many times the per-creature worker path was exercised. */
class MockWorkerHandler {
  public evaluateCallCount = 0;
  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  // deno-lint-ignore require-await
  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluateCallCount++;
    return { evaluate: { error: 0.5 } };
  }
}

function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 4; i++) {
    rows.push({
      input: new Float32Array([i, 4 - i]),
      output: new Float32Array([i > 2 ? 1 : -1]),
    });
  }
  return rows;
}

/** Build `count` distinct forwardOnly creatures. */
function buildForwardOnlyPopulation(count: number): Creature[] {
  const base: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
    forwardOnly: true,
  };
  const creatures: Creature[] = [];
  for (let i = 0; i < count; i++) {
    const forked = structuredClone(base);
    forked.neurons[0].bias = 0.1 * (i + 1);
    creatures.push(Creature.fromJSON(forked));
  }
  return creatures;
}

/** A runner that scores every supplied UUID successfully in one pass. */
function successRunner(uuids: string[]) {
  return (_command: string, args: string[]) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    const payload: Record<
      string,
      { score: number; error: number; recordCount: number }
    > = {};
    for (let i = 0; i < uuids.length; i++) {
      payload[uuids[i]] = {
        score: 0.9 - i * 0.1,
        error: 0.1 + i * 0.05,
        recordCount: 4,
      };
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
    });
  };
}

Deno.test("forwardOnly population is batch-scored every generation, never per-creature", async () => {
  const GENERATIONS = 4;
  const POPULATION_SIZE = 5;

  // In-process override (Issue #3234) — never mutate the shared process env,
  // which races across parallel test workers.
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: true });

  const population = buildForwardOnlyPopulation(POPULATION_SIZE);
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));
  __setRustScorerRunnerForTests(successRunner(uuids));

  const worker = new MockWorkerHandler();
  const dataDir = makeDataDir(buildDataSet(), 4);
  try {
    const fitness = new Fitness(
      [worker as unknown as WorkerHandler],
      0.0001,
      false,
      undefined,
      dataDir,
    );

    const acc = createScorerUtilisationAccumulator();
    for (let gen = 0; gen < GENERATIONS; gen++) {
      // Reset scores so every generation re-evaluates the whole population.
      for (const creature of population) creature.score = undefined;

      // Sequential by design: each generation reads Fitness state before the
      // next, so the calls cannot be batched into a single Promise.all.
      // deno-lint-ignore no-await-in-loop
      await fitness.calculate(population);

      accumulateScorerUtilisation(acc, {
        batchScorerInvocations: fitness.lastBatchScorerInvocations,
        creaturesBatchScored: fitness.lastCreaturesBatchScored,
        creaturesPerCreatureScored: fitness.lastCreaturesPerCreatureScored,
        batchFallbackOccurred: fitness.lastBatchFallbackOccurred,
      });

      // Every creature still ends the generation with a valid, finite score.
      for (const creature of population) {
        assert(
          typeof creature.score === "number" && Number.isFinite(creature.score),
          "creature scored with a finite value",
        );
      }
    }

    const totals = finaliseScorerUtilisationTotals(acc);

    assertEquals(totals.generations, GENERATIONS);
    // One rust_scorer process per generation — the batch path was used.
    assertEquals(
      totals.batchScorerInvocations,
      GENERATIONS,
      "batchScorerInvocations must equal the generation count",
    );
    // Every forwardOnly creature, every generation, went through the batch path.
    assertEquals(
      totals.creaturesBatchScored,
      POPULATION_SIZE * GENERATIONS,
      "creaturesBatchScored must equal the forwardOnly creatures scored",
    );
    // The per-creature worker path was never used for a forwardOnly population.
    assertEquals(totals.creaturesPerCreatureScored, 0);
    assertEquals(
      worker.evaluateCallCount,
      0,
      "no forwardOnly creature reached the per-creature worker path",
    );
    // No fallback: the batch path succeeded every generation.
    assertEquals(totals.batchFallbackGenerations, 0);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
