/**
 * A batch-scorer fallback is fatal under strict mode (Issue #3815).
 *
 * `Fitness.calculate()` normally logs a batch failure and re-scores the whole
 * generation on the per-creature worker path, so the run completes — that is
 * the graceful production behaviour asserted in
 * `FitnessBatchFallbackCounted.ts`. Under `NEAT_AI_RUST_SCORER_STRICT=1`
 * (which `quality.sh` sets) the same failure must abort the generation with the
 * scorer's own diagnostic instead, so an entirely dead native batch path can
 * never reconcile to a green CI run (Issue #3810).
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { ScorerStrictError } from "@errors/ScorerStrictError.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";

/** Multi-line stderr — strict mode must preserve it exactly. */
const SCORER_STDERR = [
  "Error: failed to deserialise creature 9f1c-4d2a",
  "  caused by: unknown field `memetic`",
].join("\n");

/** Records whether the per-creature worker path was reached at all. */
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

/** Answers the `--help` probe, then fails the batch call with `SCORER_STDERR`. */
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
    success: false,
    code: 101,
    stdout: "",
    stderr: SCORER_STDERR,
  });
}

Deno.test("Fitness strict mode: a batch scorer failure aborts the generation with the scorer's stderr", async () => {
  // In-process override (Issue #3234) — never mutate the shared process env,
  // which races across parallel test workers.
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: true, strict: true });

  const population = buildForwardOnlyPopulation(3);
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

    const error = await assertRejects(
      () => fitness.calculate(population),
      ScorerStrictError,
    );
    assert(
      error.message.includes(SCORER_STDERR),
      `strict failure must carry the scorer's stderr verbatim; got: ${error.message}`,
    );
    assertEquals(
      worker.evaluateCallCount,
      0,
      "strict mode aborts instead of silently re-scoring on the worker path",
    );
    assertEquals(
      fitness.lastBatchFallbackOccurred,
      false,
      "no fallback is reconciled — the generation failed loud",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Fitness strict mode off: the same batch failure still falls back and completes", async () => {
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: true, strict: false });

  const population = buildForwardOnlyPopulation(3);
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

    await fitness.calculate(population);

    assertEquals(
      fitness.lastBatchFallbackOccurred,
      true,
      "default behaviour records the fallback",
    );
    assertEquals(
      worker.evaluateCallCount,
      population.length,
      "every creature is re-scored on the per-creature worker path",
    );
    for (const creature of population) {
      assert(
        typeof creature.score === "number" && Number.isFinite(creature.score),
        "the generation still completes with finite scores",
      );
    }
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
