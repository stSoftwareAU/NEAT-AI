/**
 * Fitness-level per-backend scorer-utilisation split tests (Issue #3234).
 *
 * `Fitness.calculate()` splits its unique-scored creature count by backend:
 * creatures resolved via the native batch (one-pass) rust-scorer path vs the
 * per-creature worker path, plus a batch-fallback flag. These tests exercise
 * the three regressions the issue exists to expose:
 *  (a) an all-forwardOnly population batch-scores everything with zero fallback;
 *  (b) a mixed population routes recurrent creatures to the per-creature path;
 *  (c) a forced batch failure flags a fallback and re-scores every creature
 *      via the per-creature path.
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
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

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

/** Build `count` distinct creatures, forwardOnly or recurrent as requested. */
function buildPopulation(count: number, forwardOnly: boolean): Creature[] {
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
    forwardOnly,
  };
  const creatures: Creature[] = [];
  for (let i = 0; i < count; i++) {
    const forked = structuredClone(base);
    forked.neurons[0].bias = 0.1 * (i + 1) + (forwardOnly ? 0 : 100);
    creatures.push(Creature.fromJSON(forked));
  }
  return creatures;
}

/** Enable batch rust scoring, run `fn`, and always restore the env. */
async function withBatchEnabled(
  runner: Parameters<typeof __setRustScorerRunnerForTests>[0],
  fn: (fitness: Fitness, worker: MockWorkerHandler) => Promise<void>,
): Promise<void> {
  __resetRustScorerBridgeForTests();
  const prevEnabled = Deno.env.get("NEAT_AI_RUST_SCORER_ENABLED");
  const prevBatch = Deno.env.get("NEAT_AI_RUST_SCORER_BATCH");
  Deno.env.set("NEAT_AI_RUST_SCORER_ENABLED", "true");
  Deno.env.set("NEAT_AI_RUST_SCORER_BATCH", "true");
  __setRustScorerRunnerForTests(runner);
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
    await fn(fitness, worker);
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

Deno.test("scorer utilisation - all-forwardOnly population batch-scored, zero fallback", async () => {
  const population = buildPopulation(4, true);
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));
  await withBatchEnabled(successRunner(uuids), async (fitness, worker) => {
    await fitness.calculate(population);

    assertEquals(
      fitness.lastCreaturesBatchScored,
      4,
      "all creatures batch-scored",
    );
    assertEquals(fitness.lastCreaturesPerCreatureScored, 0);
    assertEquals(fitness.lastBatchScorerInvocations, 1);
    assertEquals(fitness.lastBatchFallbackOccurred, false);
    // The combined count still equals batch + worker for existing consumers.
    assertEquals(fitness.lastScoredCreatureCount, 4);
    assertEquals(worker.evaluateCallCount, 0, "batch owns scoring");
  });
});

Deno.test("scorer utilisation - mixed population routes recurrent creatures per-creature", async () => {
  const forwardOnly = buildPopulation(3, true);
  const recurrent = buildPopulation(2, false);
  const population = [...forwardOnly, ...recurrent];
  const forwardUuids = forwardOnly.map((c) => CreatureUtil.makeUUID(c));
  for (const c of recurrent) CreatureUtil.makeUUID(c);

  await withBatchEnabled(
    successRunner(forwardUuids),
    async (fitness, worker) => {
      await fitness.calculate(population);

      assertEquals(
        fitness.lastCreaturesBatchScored,
        3,
        "forwardOnly batch-scored",
      );
      assertEquals(
        fitness.lastCreaturesPerCreatureScored,
        2,
        "recurrent creatures counted per-creature",
      );
      assertEquals(fitness.lastBatchScorerInvocations, 1);
      assertEquals(fitness.lastBatchFallbackOccurred, false);
      assertEquals(fitness.lastScoredCreatureCount, 5);
      assertEquals(
        worker.evaluateCallCount,
        2,
        "only the recurrent remainder hits the worker path",
      );
    },
  );
});

Deno.test("scorer utilisation - forced batch failure flags fallback, counts per-creature", async () => {
  const population = buildPopulation(3, true);
  for (const c of population) CreatureUtil.makeUUID(c);

  // Runner returns an empty object so every expected UUID is missing — the
  // reconciler throws and Fitness falls back to the per-creature worker path.
  const failingRunner = (_command: string, args: string[]) => {
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
  };

  await withBatchEnabled(failingRunner, async (fitness, worker) => {
    await fitness.calculate(population);

    assert(
      fitness.lastBatchFallbackOccurred,
      "a batch failure must be visible as a fallback, not masked",
    );
    assertEquals(fitness.lastCreaturesBatchScored, 0, "batch scored nothing");
    assertEquals(
      fitness.lastCreaturesPerCreatureScored,
      3,
      "every creature re-scored via the per-creature path",
    );
    assertEquals(fitness.lastBatchScorerInvocations, 0);
    assertEquals(fitness.lastScoredCreatureCount, 3);
    assertEquals(worker.evaluateCallCount, 3);
  });
});

Deno.test("scorer utilisation - empty population resets the split counters", async () => {
  const population = buildPopulation(2, true);
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));
  await withBatchEnabled(successRunner(uuids), async (fitness) => {
    await fitness.calculate(population);
    assert(fitness.lastCreaturesBatchScored > 0, "primed with a real run");

    // A pre-scored population takes the early-return reset path.
    const alreadyScored = buildPopulation(1, true)[0];
    alreadyScored.score = 0.5;
    await fitness.calculate([alreadyScored]);

    assertEquals(fitness.lastCreaturesBatchScored, 0);
    assertEquals(fitness.lastCreaturesPerCreatureScored, 0);
    assertEquals(fitness.lastBatchFallbackOccurred, false);
  });
});
