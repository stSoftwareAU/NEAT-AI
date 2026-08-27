/**
 * `Fitness` publishes a per-generation native-scoring fallback verdict that
 * spans **both** scoring backends (Issue #3866).
 *
 * The pre-existing `lastBatchFallbackOccurred` only ever saw the batch catch.
 * The per-creature `rust_scorer` runs inside an evaluation worker, so its
 * degradation reaches the main thread on the evaluate response — a run in which
 * every creature quietly scored on WASM used to report clean.
 *
 * Three cases, covering both failure directions:
 *  (a) a worker-reported per-creature fallback sets the wider flag while the
 *      batch flag stays false;
 *  (b) a batch failure sets both, and the run-level aggregate survives the
 *      per-generation reset across several generations (false green);
 *  (c) an unresolvable binary is a graceful skip — the run completes with the
 *      verdict unset (false red, which would break every contributor without
 *      `rust_scorer` installed).
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
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Stands in for a real evaluation worker. `nativeFallback` mirrors what
 * `WorkerProcessor` reports after the per-creature `rust_scorer` degraded to
 * WASM inside the worker isolate.
 */
class MockWorkerHandler {
  public evaluateCallCount = 0;
  constructor(private readonly nativeFallback: boolean) {}
  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  // deno-lint-ignore require-await
  async evaluate(
    _creature: Creature,
    _feedbackLoop: boolean,
  ): Promise<{ evaluate: { error: number; nativeFallback?: boolean } }> {
    this.evaluateCallCount++;
    return { evaluate: { error: 0.5, nativeFallback: this.nativeFallback } };
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
  const perGenerationVerdicts: boolean[] = [];
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

      perGenerationVerdicts.push(fitness.lastNativeScoringFallbackOccurred);
      accumulateScorerUtilisation(acc, {
        batchScorerInvocations: fitness.lastBatchScorerInvocations,
        creaturesBatchScored: fitness.lastCreaturesBatchScored,
        creaturesPerCreatureScored: fitness.lastCreaturesPerCreatureScored,
        batchFallbackOccurred: fitness.lastBatchFallbackOccurred,
        nativeFallbackOccurred: fitness.lastNativeScoringFallbackOccurred,
      });

      // Whatever degraded, the generation still finished with usable scores.
      for (const creature of population) {
        assert(
          typeof creature.score === "number" && Number.isFinite(creature.score),
          "every creature ends the generation with a finite score",
        );
      }
    }
    return {
      totals: finaliseScorerUtilisationTotals(acc),
      perGenerationVerdicts,
      batchFallbackOccurred: fitness.lastBatchFallbackOccurred,
    };
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
}

Deno.test("FitnessNativeScoringFallback: a worker-reported per-creature fallback sets the verdict", async () => {
  // Batch scoring off, so the only native path is the per-creature one inside
  // the worker — the path the batch flag has never been able to see.
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: false, strict: false });

  const worker = new MockWorkerHandler(true);
  const { totals, perGenerationVerdicts, batchFallbackOccurred } =
    await runGenerations(2, 4, worker);

  assertEquals(perGenerationVerdicts, [true, true]);
  assertEquals(
    batchFallbackOccurred,
    false,
    "no batch attempt was made, so the pre-#3866 flag reports clean",
  );
  assertEquals(totals.batchFallbackGenerations, 0);
  assertEquals(totals.nativeFallbackGenerations, 2);
  assert(
    totals.nativeScoringFallback,
    "a run scored entirely on WASM cannot finish reporting success",
  );
});

Deno.test("FitnessNativeScoringFallback: a batch fallback survives the per-generation reset", async () => {
  // `strict: false` is the operator's explicit opt-out — the run must still
  // complete (Issue #3864 made strict the default, which throws instead).
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: true, strict: false });
  // An empty result map: every expected UUID is missing, so the reconciler
  // throws and the whole generation reverts to the per-creature worker path.
  __setRustScorerRunnerForTests(
    runnerWith(() => ({ success: true, code: 0, stdout: "{}", stderr: "" })),
  );

  const worker = new MockWorkerHandler(false);
  const { totals, perGenerationVerdicts } = await runGenerations(2, 4, worker);

  // Each generation recovered on WASM and cleared its own flag; only the run
  // aggregate can still see that the native path served nothing.
  assertEquals(perGenerationVerdicts, [true, true]);
  assertEquals(totals.batchFallbackGenerations, 2);
  assertEquals(totals.nativeFallbackGenerations, 2);
  assert(totals.nativeScoringFallback);
  assertEquals(totals.creaturesBatchScored, 0, "batch scored nothing");
  assertEquals(worker.evaluateCallCount, 8, "every creature re-scored on WASM");
});

Deno.test("FitnessNativeScoringFallback: no rust_scorer installed is not a fallback", async () => {
  // False red: the `--help` probe fails, so the binary is absent. This is the
  // state of every contributor machine without `rust_scorer` — the run must
  // complete with the verdict unset.
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({
    enabled: true,
    batch: true,
    strict: false,
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

  const worker = new MockWorkerHandler(false);
  const { totals, perGenerationVerdicts } = await runGenerations(2, 4, worker);

  assertEquals(perGenerationVerdicts, [false, false]);
  assertEquals(totals.batchFallbackGenerations, 0);
  assertEquals(totals.nativeFallbackGenerations, 0);
  assertEquals(
    totals.nativeScoringFallback,
    false,
    "a graceful skip must never fail the run",
  );
  assertEquals(worker.evaluateCallCount, 8, "every creature scored on WASM");
});
