/**
 * `Fitness` scores with the run's resolved scorer config, not the environment
 * (Issue #3865).
 *
 * `NeatOptions.rustScorer` is resolved once per run — explicit option over
 * `NEAT_AI_RUST_SCORER_*` over the built-in default — and handed to `Fitness`.
 * These tests drive the two directions that matter through the real batch path:
 *
 * - an option that says **on** batch-scores even though the env layer says off;
 * - an option that says **off** never reaches the scorer even though the env
 *   layer says on. That is the direction that fails open silently: the native
 *   path would run for a caller who asked for it off and every score would
 *   still look plausible.
 *
 * The env layer is forced in-process via `__setRustScorerConfigForTests`
 * (Issue #3234) rather than through `Deno.env`, which races under
 * `deno test --parallel`.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";

/** Records how many creatures took the per-creature worker path. */
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

/** A runner that scores every supplied UUID successfully in one pass. */
function successRunner(uuids: string[], onScore: () => void) {
  return (_command: string, args: string[]) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    onScore();
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

function resolvedConfig(enabled: boolean): RequiredRustScorerConfig {
  return {
    enabled,
    binaryPath: "rust_scorer",
    timeoutMs: 0,
    env: {},
    batch: true,
    strict: false,
  };
}

/**
 * Run one generation with `envEnabled` forced on the env layer and
 * `optionEnabled` supplied as the run's resolved config.
 */
async function runGeneration(
  envEnabled: boolean,
  optionEnabled: boolean,
): Promise<
  { scorerRuns: number; batchScored: number; workerCalls: number }
> {
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({
    enabled: envEnabled,
    batch: true,
    strict: false,
  });

  const population = buildForwardOnlyPopulation(3);
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));
  let scorerRuns = 0;
  __setRustScorerRunnerForTests(successRunner(uuids, () => scorerRuns++));

  const worker = new MockWorkerHandler();
  const dataDir = makeDataDir(buildDataSet(), 4);
  try {
    const fitness = new Fitness(
      [worker as unknown as WorkerHandler],
      0.0001,
      false,
      undefined,
      dataDir,
      undefined,
      undefined,
      undefined,
      resolvedConfig(optionEnabled),
    );
    await fitness.calculate(population);

    for (const creature of population) {
      assert(
        typeof creature.score === "number" && Number.isFinite(creature.score),
        "every creature still ends the generation with a finite score",
      );
    }

    return {
      scorerRuns,
      batchScored: fitness.lastCreaturesBatchScored,
      workerCalls: worker.evaluateCallCount,
    };
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
}

Deno.test("Fitness: rustScorer.enabled:true batch-scores even when the env layer is off", async () => {
  const result = await runGeneration(false, true);

  assertEquals(result.scorerRuns, 1, "one rust_scorer run for the generation");
  assertEquals(result.batchScored, 3, "the whole population was batch-scored");
  assertEquals(
    result.workerCalls,
    0,
    "no creature fell back to the per-creature worker path",
  );
});

Deno.test("Fitness: rustScorer.enabled:false keeps the scorer off when the env layer is on", async () => {
  const result = await runGeneration(true, false);

  assertEquals(
    result.scorerRuns,
    0,
    "an explicit enabled:false must never invoke the native scorer",
  );
  assertEquals(result.batchScored, 0, "nothing was batch-scored");
  assertEquals(
    result.workerCalls,
    3,
    "every creature took the per-creature worker path instead",
  );
});
