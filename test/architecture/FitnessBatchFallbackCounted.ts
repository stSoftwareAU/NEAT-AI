/**
 * Permanent assertion: a batch-scorer failure is **counted** as a fallback, not
 * silently swallowed (Issue #3237, parent #3233).
 *
 * When `tryBatchScoreWithRustScorer` fails for a `forwardOnly` population,
 * `Fitness.calculate()` reverts the whole generation to the per-creature worker
 * path so the generation still completes — but it must record that it did so.
 * This test forces a batch failure (the runner returns an empty result map, so
 * every expected UUID is missing and the reconciler throws
 * `BatchScorerError`) across several generations and accumulates the per-backend
 * counts into the run-level {@link ScorerUtilisationTotals}.
 *
 * It fails if a fallback stops being recorded: `batchFallbackGenerations` would
 * read zero even though the batch path never scored anything and every creature
 * quietly re-scored on the slow worker path — exactly the "never fail silently"
 * regression this telemetry exists to expose.
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

/**
 * A runner that responds to the `--help` probe but returns an empty result map
 * for the batch call, so every expected UUID is missing and the reconciler
 * throws `BatchScorerError` — forcing the per-creature fallback.
 */
function failingRunner(_command: string, args: string[]) {
  if (args.length === 1 && args[0] === "--help") {
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: "usage",
      stderr: "",
    });
  }
  return Promise.resolve({
    success: true,
    code: 0,
    stdout: "{}",
    stderr: "",
  });
}

Deno.test("batch failure is counted as a fallback and re-scored per-creature every generation", async () => {
  const GENERATIONS = 3;
  const POPULATION_SIZE = 4;

  __resetRustScorerBridgeForTests();
  const prevEnabled = Deno.env.get("NEAT_AI_RUST_SCORER_ENABLED");
  const prevBatch = Deno.env.get("NEAT_AI_RUST_SCORER_BATCH");
  Deno.env.set("NEAT_AI_RUST_SCORER_ENABLED", "true");
  Deno.env.set("NEAT_AI_RUST_SCORER_BATCH", "true");

  const population = buildForwardOnlyPopulation(POPULATION_SIZE);
  for (const c of population) CreatureUtil.makeUUID(c);
  __setRustScorerRunnerForTests(failingRunner);

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

      // The generation still completes with valid, finite scores despite the
      // batch failure — the fallback is graceful, not lost.
      for (const creature of population) {
        assert(
          typeof creature.score === "number" && Number.isFinite(creature.score),
          "creature scored with a finite value via the fallback path",
        );
      }
    }

    const totals = finaliseScorerUtilisationTotals(acc);

    assertEquals(totals.generations, GENERATIONS);
    // Every generation's batch attempt failed and was counted — not swallowed.
    assert(
      totals.batchFallbackGenerations > 0,
      "a batch failure must be recorded as a fallback, never masked as success",
    );
    assertEquals(
      totals.batchFallbackGenerations,
      GENERATIONS,
      "every generation's batch failure is counted",
    );
    // Nothing was batch-scored; the affected creatures counted as per-creature.
    assertEquals(totals.creaturesBatchScored, 0, "batch scored nothing");
    assertEquals(
      totals.creaturesPerCreatureScored,
      POPULATION_SIZE * GENERATIONS,
      "fallback creatures counted as per-creature-scored",
    );
    assertEquals(
      worker.evaluateCallCount,
      POPULATION_SIZE * GENERATIONS,
      "every creature re-scored on the per-creature worker path",
    );
  } finally {
    if (prevEnabled === undefined) {
      Deno.env.delete("NEAT_AI_RUST_SCORER_ENABLED");
    } else {
      Deno.env.set("NEAT_AI_RUST_SCORER_ENABLED", prevEnabled);
    }
    if (prevBatch === undefined) {
      Deno.env.delete("NEAT_AI_RUST_SCORER_BATCH");
    } else {
      Deno.env.set("NEAT_AI_RUST_SCORER_BATCH", prevBatch);
    }
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
