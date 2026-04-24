/**
 * Fitness-level batch rust scorer tests (Issue #2422).
 *
 * Verifies that when the external `rust_scorer` binary is enabled in batch
 * mode, `Fitness.calculate` invokes the scorer process exactly once per
 * generation, maps the per-creature results back by UUID stem, and bypasses
 * the per-creature worker evaluation path.
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

class MockWorkerHandler {
  public evaluateCallCount = 0;
  private busy = false;
  private idleListeners: (() => void)[] = [];

  addIdleListener(callback: () => void): void {
    this.idleListeners.push(callback);
  }

  isBusy(): boolean {
    return this.busy;
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

function buildPopulation(count: number): Creature[] {
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
  };
  const creatures: Creature[] = [];
  for (let i = 0; i < count; i++) {
    // Distinct biases → distinct UUIDs so dedup does not collapse them.
    const forked = structuredClone(base);
    forked.neurons[0].bias = 0.1 * (i + 1);
    creatures.push(Creature.fromJSON(forked));
  }
  return creatures;
}

Deno.test("Fitness.calculate batch rust scorer - one scorer process per generation", async () => {
  __resetRustScorerBridgeForTests();
  const prevEnabled = Deno.env.get("NEAT_AI_RUST_SCORER_ENABLED");
  const prevBatch = Deno.env.get("NEAT_AI_RUST_SCORER_BATCH");
  Deno.env.set("NEAT_AI_RUST_SCORER_ENABLED", "true");
  Deno.env.set("NEAT_AI_RUST_SCORER_BATCH", "true");

  const population = buildPopulation(4);
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));

  let scoreCalls = 0;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    scoreCalls++;
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
  });

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
    await fitness.calculate(population);

    // Exactly one scorer process for the whole generation.
    assertEquals(scoreCalls, 1, "exactly one scorer process per generation");
    assertEquals(fitness.lastBatchScorerInvocations, 1);
    // Worker evaluate must not be called because batch mode owns scoring.
    assertEquals(
      worker.evaluateCallCount,
      0,
      "batch mode should bypass the per-creature worker path",
    );
    // All creatures scored.
    for (const creature of population) {
      assert(creature.score !== undefined, "every creature should be scored");
    }
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

Deno.test("Fitness.calculate batch rust scorer - falls back to worker path on reconciliation failure", async () => {
  __resetRustScorerBridgeForTests();
  const prevEnabled = Deno.env.get("NEAT_AI_RUST_SCORER_ENABLED");
  const prevBatch = Deno.env.get("NEAT_AI_RUST_SCORER_BATCH");
  Deno.env.set("NEAT_AI_RUST_SCORER_ENABLED", "true");
  Deno.env.set("NEAT_AI_RUST_SCORER_BATCH", "true");

  const population = buildPopulation(3);
  // Generate UUIDs up-front so the reconciler knows what to expect.
  for (const c of population) CreatureUtil.makeUUID(c);

  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    // Return an empty object so every expected UUID is missing — reconciler
    // throws a MISSING_KEYS BatchScorerError and Fitness.calculate falls
    // back to the per-creature worker path.
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: "{}",
      stderr: "",
    });
  });

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
    await fitness.calculate(population);

    // Fallback engaged: every unique creature goes through the worker path.
    assertEquals(
      worker.evaluateCallCount,
      population.length,
      "per-creature worker fallback should score every creature",
    );
    // Still records the single batch invocation attempt.
    assertEquals(fitness.lastBatchScorerInvocations, 0);
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
