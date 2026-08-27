/**
 * A `rust_scorer` that was never available is a graceful **skip**, not a
 * failure (Issues #3866, #3871).
 *
 * Issue #3871 deleted the degrading fallback: a scorer that is present and
 * fails now aborts the generation, and the run-level fallback verdict went with
 * it. The distinction it protected still matters and is what this file pins —
 * "not installed" is not "degraded". A missing binary means the request never
 * reached the native engine, so the TypeScript/WASM engine serves it and the
 * run completes normally.
 *
 * Two directions, both regressions worth catching:
 *  (a) an unresolvable binary completes the run on the WASM path;
 *  (b) a binary that *is* resolvable and then fails aborts instead — the case
 *      that must never quietly become a skip.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { ScorerStrictError } from "@errors/ScorerStrictError.ts";
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

/** Stands in for a real evaluation worker on the per-creature path. */
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

/** Answers the `--help` probe, then returns `respond()` for the batch call. */
function runnerWith(
  respond: () => {
    success: boolean;
    code: number;
    stdout: string;
    stderr: string;
  },
) {
  return (_command: string, args: string[]) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    return Promise.resolve(respond());
  };
}

/**
 * Run `generations` of `Fitness.calculate` over a fresh population, folding the
 * per-generation counters into a run-level accumulator exactly as
 * `finishGeneration` does. Returns the finalised totals plus the worker.
 */
async function runGenerations(
  generations: number,
  populationSize: number,
  worker: MockWorkerHandler,
) {
  const population = buildForwardOnlyPopulation(populationSize);
  for (const creature of population) CreatureUtil.makeUUID(creature);

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
    for (let generation = 0; generation < generations; generation++) {
      for (const creature of population) creature.score = undefined;

      // Sequential by design: each generation reads Fitness state before the
      // next, so the calls cannot be batched into a single Promise.all.
      // deno-lint-ignore no-await-in-loop
      await fitness.calculate(population);

      accumulateScorerUtilisation(acc, {
        batchScorerInvocations: fitness.lastBatchScorerInvocations,
        creaturesBatchScored: fitness.lastCreaturesBatchScored,
        creaturesPerCreatureScored: fitness.lastCreaturesPerCreatureScored,
      });

      // The generation finished with usable scores from the WASM engine.
      for (const creature of population) {
        assert(
          typeof creature.score === "number" && Number.isFinite(creature.score),
          "every creature ends the generation with a finite score",
        );
      }
    }
    return { totals: finaliseScorerUtilisationTotals(acc) };
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
}

Deno.test("FitnessNativeScoringFallback: no rust_scorer installed is a graceful skip", async () => {
  // The `--help` probe fails, so the binary is absent. This is the state of a
  // consumer machine without `rust_scorer`: the request never reached the
  // native engine, so it is served by WASM and the run completes.
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({
    enabled: true,
    batch: true,
    binaryPath: "/nonexistent/rust_scorer",
  });
  __setRustScorerRunnerForTests(() =>
    Promise.resolve({
      success: false,
      code: 127,
      stdout: "",
      stderr: "command not found: rust_scorer",
    })
  );

  const worker = new MockWorkerHandler();
  const { totals } = await runGenerations(2, 4, worker);

  assertEquals(totals.generations, 2);
  assertEquals(
    totals.batchScorerInvocations,
    0,
    "an absent binary is never spawned",
  );
  assertEquals(totals.creaturesBatchScored, 0);
  assertEquals(totals.creaturesPerCreatureScored, 8);
  assertEquals(worker.evaluateCallCount, 8, "every creature scored on WASM");
});

Deno.test("FitnessNativeScoringFallback: a resolvable binary that fails aborts, never skips", async () => {
  // The opposite direction: the probe succeeds, so the scorer *was* available.
  // Issue #3871 — that failure is the generation's outcome; degrading to the
  // WASM engine here is exactly what let Issue #3810 reconcile to green.
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: true });
  __setRustScorerRunnerForTests(
    runnerWith(() => ({
      success: false,
      code: 101,
      stdout: "",
      stderr: "Error: failed to deserialise creature",
    })),
  );

  const worker = new MockWorkerHandler();
  await assertRejects(
    () => runGenerations(1, 4, worker),
    ScorerStrictError,
  );
  assertEquals(
    worker.evaluateCallCount,
    0,
    "a live scorer's failure must not silently reroute to the WASM engine",
  );
});
