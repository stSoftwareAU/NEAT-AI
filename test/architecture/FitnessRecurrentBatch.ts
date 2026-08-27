/**
 * Recurrent creatures in a directory-mode batch (Issue #3870).
 *
 * Against a scorer carrying NEAT-AI-scorer#579, a mixed population must batch
 * in **one** invocation instead of splitting recurrent creatures onto the
 * per-creature worker path. Two boundaries survive that change and are pinned
 * here beside it:
 *
 * - `feedbackLoop: true` recurrent creatures still refuse (`FEEDBACK_LOOP`) and
 *   still score on the TypeScript path, because the native recurrent path
 *   resets state per record whatever the scorer version.
 * - The capability answer is cached, so the probe costs one subprocess per
 *   configuration and not one per generation.
 *
 * The older-binary half of the contract — the partition, unchanged — lives in
 * `test/architecture/FitnessForwardOnlyPartition.ts`.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import { modernScorer } from "./FitnessScorerDoubles.ts";

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

/** Force batch scoring on in-process, without touching the shared env. */
function enableBatchConfig(): void {
  __setRustScorerConfigForTests({ enabled: true, batch: true });
}

/** Capture the INFO lines a block emits, restoring the previous logger after. */
async function captureInfo(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const previous = getLogger();
  const capturing: Logger = {
    debug: (...args: unknown[]) => previous.debug(...args),
    info: (...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(" "));
    },
    warn: (...args: unknown[]) => previous.warn(...args),
    error: (...args: unknown[]) => previous.error(...args),
  };
  setLogger(capturing);
  try {
    await fn();
  } finally {
    setLogger(previous);
  }
  return lines;
}

Deno.test("Fitness recurrent batch - a supporting scorer batches a mixed population in one invocation", async () => {
  __resetRustScorerBridgeForTests();
  enableBatchConfig();

  const population = [
    buildCreature(0.11, true),
    buildCreature(0.21, false),
    buildCreature(0.12, true),
    buildCreature(0.22, false),
  ];
  const allUuids = population.map((c) => CreatureUtil.makeUUID(c)).sort();

  const { runner, log } = modernScorer();
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
    const lines = await captureInfo(() => fitness.calculate(population));

    assertEquals(
      fitness.lastBatchScorerInvocations,
      1,
      "the whole mixed population must be scored in one batch invocation",
    );
    const batchCall = log.directoryCalls.find((call) =>
      call.stems.length === population.length
    );
    assert(
      batchCall !== undefined,
      `no call carried the whole population; saw ${
        JSON.stringify(log.directoryCalls)
      }`,
    );
    assertEquals(
      batchCall.stems,
      allUuids,
      "every creature — recurrent included — belongs in the batch directory",
    );
    assertEquals(
      batchCall.recurrentStems.length,
      2,
      "the batch must actually carry the recurrent creatures",
    );
    assertEquals(
      worker.evaluateCallCount,
      0,
      "no creature should fall to the per-creature worker path",
    );
    for (const creature of population) {
      assert(
        creature.score !== undefined,
        `every creature should be scored, missed ${creature.uuid}`,
      );
    }
    assertEquals(fitness.lastScoredCreatureCount, population.length);

    const partitionLine = lines.find((l) =>
      l.includes("Batch scorer partition")
    );
    assert(
      partitionLine !== undefined,
      `the partition INFO line must survive; saw ${JSON.stringify(lines)}`,
    );
    assert(
      /2 forwardOnly batched, 2 recurrent batched, 0 per-creature/.test(
        partitionLine,
      ),
      `partition line must show the recurrent creatures batching, got: ${partitionLine}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Fitness recurrent batch - an all-recurrent population batches too", async () => {
  __resetRustScorerBridgeForTests();
  enableBatchConfig();

  const population = [
    buildCreature(0.31, false),
    buildCreature(0.32, false),
  ];
  for (const c of population) CreatureUtil.makeUUID(c);

  const { runner, log } = modernScorer();
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

    assertEquals(fitness.lastBatchScorerInvocations, 1);
    assertEquals(
      worker.evaluateCallCount,
      0,
      "recurrent creatures no longer need the per-creature worker path",
    );
    const batchCall = log.directoryCalls.find((call) =>
      call.stems.length === population.length
    );
    assert(batchCall !== undefined, "the population must reach the scorer");
    assertEquals(batchCall.recurrentStems.length, population.length);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Fitness recurrent batch - feedbackLoop keeps recurrent creatures on the TypeScript path", async () => {
  __resetRustScorerBridgeForTests();
  enableBatchConfig();

  const fwd = buildCreature(0.41, true);
  const rec = buildCreature(0.42, false);
  const population = [fwd, rec];
  const fwdUuid = CreatureUtil.makeUUID(fwd);
  const recUuid = CreatureUtil.makeUUID(rec);

  const { runner, log } = modernScorer();
  __setRustScorerRunnerForTests(runner);

  const worker = new MockWorkerHandler();
  const dataDir = makeDataDir(buildDataSet(), 4);
  try {
    const fitness = new Fitness(
      [worker as unknown as WorkerHandler],
      0.0001,
      // feedbackLoop: the native recurrent path resets state per record, so a
      // recurrent creature must not batch however capable the binary is.
      true,
      undefined,
      dataDir,
    );
    await fitness.calculate(population);

    assertEquals(fitness.lastBatchScorerInvocations, 1);
    for (const call of log.directoryCalls) {
      assertEquals(
        call.recurrentStems,
        [],
        "a feedbackLoop run must never hand a recurrent creature to the " +
          "scorer — not even to the capability probe's batch",
      );
    }
    const batchCall = log.directoryCalls[log.directoryCalls.length - 1];
    assertEquals(batchCall.stems, [fwdUuid]);
    assertEquals(
      worker.seenUuids,
      [recUuid],
      "the recurrent creature must score on the TypeScript worker path",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Fitness recurrent batch - the capability is probed once, not once per generation", async () => {
  __resetRustScorerBridgeForTests();
  enableBatchConfig();

  const { runner, log } = modernScorer();
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
    for (let generation = 0; generation < 3; generation++) {
      const population = [
        buildCreature(0.5 + generation, true),
        buildCreature(0.6 + generation, false),
      ];
      // deno-lint-ignore no-await-in-loop -- generations are sequential
      await fitness.calculate(population);
    }

    // Three generations, three batches — plus exactly one probe.
    assertEquals(
      log.directoryCalls.length,
      4,
      `expected 3 batches and 1 cached probe, saw ${
        JSON.stringify(log.directoryCalls.map((c) => c.stems.length))
      }`,
    );
    assertEquals(
      worker.evaluateCallCount,
      0,
      "every creature batched across every generation",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
