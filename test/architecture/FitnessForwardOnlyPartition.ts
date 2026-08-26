/**
 * Fitness forwardOnly partition tests (Issue #2517).
 *
 * Verifies that mixed populations (forwardOnly + recurrent) are partitioned
 * before the batch rust scorer is invoked, on a scorer that rejects
 * directories containing any `forwardOnly=false` creature — passing it a mixed
 * batch poisons the entire generation. The partition routes only forwardOnly
 * creatures into the batch path and lets recurrent creatures take the
 * per-creature worker path.
 *
 * Issue #3870: that rejection is no longer universal — NEAT-AI-scorer#579
 * threads each creature's own flag through the batch loop, so a new enough
 * binary batches a mixed population in one invocation. The capability is
 * probed, and this file now pins the **older-binary** half of that contract:
 * every double here is {@link legacyScorer}, which refuses exactly as a
 * pre-#579 binary does, and the partition behaviour below must be unchanged
 * against it. The supporting-binary half lives in
 * `test/architecture/FitnessRecurrentBatch.ts`.
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
import { legacyScorer } from "./FitnessScorerDoubles.ts";

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
  __setRustScorerConfigForTests({ enabled: true, batch: true, strict: false });
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

  const { runner, log } = legacyScorer();
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
    await fitness.calculate(population);

    assertEquals(
      log.directoryCalls.length,
      1,
      "exactly one scorer process for all-forwardOnly population — nothing " +
        "is recurrent, so the capability probe must not spawn either",
    );
    assertEquals(fitness.lastBatchScorerInvocations, 1);
    assertEquals(
      worker.evaluateCallCount,
      0,
      "all forwardOnly creatures must take the batch path",
    );
    assertEquals(
      log.directoryCalls[0].stems.join(","),
      [...uuids].sort().join(","),
    );
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

  const { runner, log } = legacyScorer();
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
    await fitness.calculate(population);

    // Issue #3870: the capability probe is the one directory-mode call — it
    // asks whether this binary can batch recurrent creatures, and this one
    // refuses. No population creature is ever handed to it.
    assertEquals(
      log.directoryCalls.length,
      1,
      "only the capability probe should spawn when no creature is forwardOnly",
    );
    assertEquals(
      log.directoryCalls[0].refused,
      true,
      "a pre-#579 binary refuses the recurrent probe",
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

  const { runner, log } = legacyScorer();
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
    await fitness.calculate(population);

    // Two directory calls: the refused capability probe, then the batch of
    // the forwardOnly subset it fell back to.
    assertEquals(
      log.directoryCalls.length,
      2,
      "one capability probe plus one scorer process for the forwardOnly subset",
    );
    assertEquals(fitness.lastBatchScorerInvocations, 1);
    const batchCall = log.directoryCalls.find((call) => !call.refused);
    assert(batchCall !== undefined, "the forwardOnly subset must be batched");
    assertEquals(
      batchCall.stems,
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
    // sent and should still be scored by the worker path. It also answers the
    // Issue #3870 capability probe with unusable output, which is likewise
    // read as "cannot batch recurrent creatures".
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
