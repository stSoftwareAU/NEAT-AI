/**
 * Fitness forwardOnly partition tests (Issue #2517).
 *
 * Verifies that mixed populations (forwardOnly + recurrent) are partitioned
 * before the batch rust scorer is invoked. The scorer rejects directories
 * containing any `forwardOnly=false` creature, so passing a mixed batch
 * poisons the entire generation. The partition routes only forwardOnly
 * creatures into the batch path and lets recurrent creatures take the
 * per-creature worker path.
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
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";

class MockWorkerHandler {
  public evaluateCallCount = 0;
  public seenUuids: string[] = [];

  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  // deno-lint-ignore require-await
  async evaluate(
    creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number } }> {
    this.evaluateCallCount++;
    this.seenUuids.push(creature.uuid ?? "<no-uuid>");
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

function buildCreature(bias: number, forwardOnly: boolean): Creature {
  const data: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: `hidden-${bias}`, squash: "TANH", bias },
      { type: "output", uuid: `output-${bias}`, squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: `hidden-${bias}`, weight: 0.5 },
      { fromUUID: `hidden-${bias}`, toUUID: `output-${bias}`, weight: 0.8 },
    ],
    input: 2,
    output: 1,
    forwardOnly,
  };
  return Creature.fromJSON(data);
}

/**
 * Force batch scoring on in-process (Issue #3234). Callers pair this with a
 * `__resetRustScorerBridgeForTests()` in their `finally`, which clears the
 * override. This never touches the shared process env, so parallel test
 * workers cannot race on it.
 */
function enableBatchConfig(): void {
  __setRustScorerConfigForTests({ enabled: true, batch: true });
}

Deno.test("Fitness partition - all forwardOnly population batches every creature", async () => {
  __resetRustScorerBridgeForTests();
  enableBatchConfig();

  const population = [
    buildCreature(0.1, true),
    buildCreature(0.2, true),
    buildCreature(0.3, true),
  ];
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));

  let scoreCalls = 0;
  let seenStems: string[] = [];
  __setRustScorerRunnerForTests(async (_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return { success: true, code: 0, stdout: "usage", stderr: "" };
    }
    scoreCalls++;
    // Inspect the directory to capture the stems the scorer would see — this
    // is what the rust scorer's pre-check inspects.
    const entries: string[] = [];
    for await (const entry of Deno.readDir(args[0])) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        entries.push(entry.name.replace(/\.json$/, ""));
      }
    }
    seenStems = entries.sort();
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
    return {
      success: true,
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
    };
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

    assertEquals(
      scoreCalls,
      1,
      "exactly one scorer process for all-forwardOnly population",
    );
    assertEquals(fitness.lastBatchScorerInvocations, 1);
    assertEquals(
      worker.evaluateCallCount,
      0,
      "all forwardOnly creatures must take the batch path",
    );
    assertEquals(seenStems.sort().join(","), [...uuids].sort().join(","));
    for (const creature of population) {
      assert(creature.score !== undefined, "every creature should be scored");
    }
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Fitness partition - all recurrent population skips batch entirely", async () => {
  __resetRustScorerBridgeForTests();
  enableBatchConfig();

  const population = [
    buildCreature(0.1, false),
    buildCreature(0.2, false),
    buildCreature(0.3, false),
  ];

  let scoreCalls = 0;
  __setRustScorerRunnerForTests(async (_command, args) => {
    // Even the probe must not be needed when there is nothing to batch.
    // Allow probe for safety, but count any actual scoring call.
    if (args.length === 1 && args[0] === "--help") {
      return await Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    scoreCalls++;
    return await Promise.resolve({
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

    assertEquals(
      scoreCalls,
      0,
      "no scorer process should spawn when no creature is forwardOnly",
    );
    assertEquals(fitness.lastBatchScorerInvocations, 0);
    assertEquals(
      worker.evaluateCallCount,
      population.length,
      "every recurrent creature should score via the per-creature worker path",
    );
    for (const creature of population) {
      assert(creature.score !== undefined, "every creature should be scored");
    }
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Fitness partition - mixed population batches forwardOnly only, recurrent via worker", async () => {
  __resetRustScorerBridgeForTests();
  enableBatchConfig();

  const fwd1 = buildCreature(0.11, true);
  const fwd2 = buildCreature(0.12, true);
  const rec1 = buildCreature(0.21, false);
  const rec2 = buildCreature(0.22, false);
  const population = [fwd1, rec1, fwd2, rec2];
  const fwdUuids = [
    CreatureUtil.makeUUID(fwd1),
    CreatureUtil.makeUUID(fwd2),
  ].sort();
  const recUuids = new Set([
    CreatureUtil.makeUUID(rec1),
    CreatureUtil.makeUUID(rec2),
  ]);

  let scoreCalls = 0;
  let seenStems: string[] = [];
  __setRustScorerRunnerForTests(async (_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return { success: true, code: 0, stdout: "usage", stderr: "" };
    }
    scoreCalls++;
    const entries: string[] = [];
    for await (const entry of Deno.readDir(args[0])) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        entries.push(entry.name.replace(/\.json$/, ""));
      }
    }
    seenStems = entries.sort();
    const payload: Record<
      string,
      { score: number; error: number; recordCount: number }
    > = {};
    for (const stem of entries) {
      payload[stem] = { score: 0.5, error: 0.25, recordCount: 4 };
    }
    return {
      success: true,
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
    };
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

    assertEquals(
      scoreCalls,
      1,
      "one scorer process for the forwardOnly subset",
    );
    assertEquals(fitness.lastBatchScorerInvocations, 1);
    assertEquals(
      seenStems,
      fwdUuids,
      "scorer must see forwardOnly stems only — recurrent creatures must not appear in the batch directory",
    );
    assertEquals(
      worker.evaluateCallCount,
      2,
      "only the recurrent creatures should travel the per-creature worker path",
    );
    for (const seen of worker.seenUuids) {
      assert(
        recUuids.has(seen),
        `worker should only score recurrent creatures, saw ${seen}`,
      );
    }
    for (const creature of population) {
      assert(
        creature.score !== undefined,
        `every creature should be scored, missed ${creature.uuid}`,
      );
    }
    // Telemetry: scored count covers both paths (4 unique creatures).
    assertEquals(fitness.lastScoredCreatureCount, 4);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Fitness partition - batch failure on forwardOnly subset still scores recurrent via worker", async () => {
  __resetRustScorerBridgeForTests();
  enableBatchConfig();

  const fwd = buildCreature(0.31, true);
  const rec = buildCreature(0.32, false);
  const population = [fwd, rec];
  for (const c of population) CreatureUtil.makeUUID(c);

  __setRustScorerRunnerForTests(async (_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return await Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    // Empty payload triggers MISSING_KEYS reconciliation failure for the
    // forwardOnly creature in the batch — the recurrent creature is never
    // sent and should still be scored by the worker path.
    return await Promise.resolve({
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

    // Worker scores both creatures (recurrent always; forwardOnly because
    // batch fell back).
    assertEquals(
      worker.evaluateCallCount,
      2,
      "worker fallback must score both forwardOnly and recurrent creatures",
    );
    for (const creature of population) {
      assert(creature.score !== undefined, "every creature should be scored");
    }
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
