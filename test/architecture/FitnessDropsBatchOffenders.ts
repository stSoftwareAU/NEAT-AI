/**
 * GRQ#4387 — a generation survives one creature the batch scorer refuses.
 *
 * `rust_scorer` directory mode isolates a creature it cannot compile and exits
 * `3` with a complete map. `Fitness.calculate` must take the scores it got,
 * drop just the offender — score it `-Infinity` so selection eliminates it —
 * and leave everyone else's score exactly where a clean batch would have.
 *
 * What must NOT happen: the offender quietly receiving a score it was never
 * given, the generation falling back to the per-creature worker path, or the
 * whole generation being lost. The last is what killed GRQ-25.
 */

import { assert, assertEquals } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";

/** Counts any use of the per-creature worker path. */
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
 * A runner that scores every UUID except `poisonUuid`, which it reports as a
 * `COMPILE` offender — the exact shape `rust_scorer` emits on exit 3.
 */
function partialRunner(uuids: string[], poisonUuid: string) {
  return (_command: string, args: string[]) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    const payload: Record<string, unknown> = {};
    for (let i = 0; i < uuids.length; i++) {
      payload[uuids[i]] = uuids[i] === poisonUuid
        ? {
          failed: true,
          reason: "COMPILE",
          message: `Failed compiling worker network for creature '/tmp/batch/${
            uuids[i]
          }.json': duplicate synapse input-0 -> hidden-0`,
        }
        : { score: 0.9 - i * 0.1, error: 0.1 + i * 0.05, recordCount: 4 };
    }
    return Promise.resolve({
      success: false,
      code: 3,
      stdout: JSON.stringify(payload),
      stderr:
        `[creature-failed] ${poisonUuid}: Failed compiling worker network\n`,
    });
  };
}

Deno.test("a refused creature is dropped; the rest of the generation keeps its scores", async () => {
  const POPULATION_SIZE = 5;

  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: true, strict: false });

  const population = buildForwardOnlyPopulation(POPULATION_SIZE);
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));
  const poisonIndex = 2;
  const poisonUuid = uuids[poisonIndex];
  __setRustScorerRunnerForTests(partialRunner(uuids, poisonUuid));

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

    // The batch ran once — no fallback to the slow path, no lost generation.
    assertEquals(fitness.lastBatchScorerInvocations, 1);
    assertEquals(fitness.lastBatchFallbackOccurred, false);
    assertEquals(
      worker.evaluateCallCount,
      0,
      "no creature should have reverted to the per-creature worker path",
    );

    // The offender is named, and named only once.
    assertEquals(fitness.lastBatchScorerOffenders, [poisonUuid]);

    // Every survivor kept a real, finite score.
    assertEquals(
      fitness.lastCreaturesBatchScored,
      POPULATION_SIZE - 1,
      "every creature but the offender must be batch-scored",
    );
    for (let i = 0; i < population.length; i++) {
      const creature = population[i];
      if (i === poisonIndex) continue;
      assert(
        typeof creature.score === "number" && Number.isFinite(creature.score),
        `survivor ${i} must keep a finite score, got ${creature.score}`,
      );
    }

    // The offender is out of contention, and carries why.
    const poison = population[poisonIndex];
    assertEquals(poison.score, -Infinity);
    assertEquals(getTag(poison, "error"), "Infinity");
    assertEquals(getTag(poison, "batch-scorer-refused"), "COMPILE");
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("a clean batch leaves the offender list empty", async () => {
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: true, strict: false });

  const population = buildForwardOnlyPopulation(3);
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));
  __setRustScorerRunnerForTests((_command: string, args: string[]) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    const payload: Record<string, unknown> = {};
    for (const uuid of uuids) {
      payload[uuid] = { score: 0.9, error: 0.1, recordCount: 4 };
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
    assertEquals(fitness.lastBatchScorerOffenders, []);
    assertEquals(fitness.lastCreaturesBatchScored, 3);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
