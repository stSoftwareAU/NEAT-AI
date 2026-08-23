/**
 * Issue #3854: the TypeScript/WASM dataset-scoring path is demoted to the
 * cases `rust_scorer` provably cannot serve — and it must keep *exactly* those
 * cases. These tests pin the delegation boundary itself: the predicate that
 * decides, and the two call sites that obey it.
 *
 * They use the in-process runner seam rather than a real binary, so they run
 * everywhere. `test/score/RustScorerDatasetParity.ts` covers the numbers.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import type { RequiredOutputRange } from "@config/OutputRangeConfig.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import {
  isBuiltInCostName,
  nativeDatasetScoringEligibility,
} from "../../src/score/NativeDatasetScoringEligibility.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerConfigForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import { initWasmForTests } from "../_initWasm.ts";
import {
  buildScoringCreature,
  buildScoringDataSet,
  makeScoringDataDir,
} from "./NativeScorerFixtures.ts";

const RANGES: ReadonlyArray<RequiredOutputRange> = [
  { min: 0.95, max: 0.99, penaltyWeight: 2 },
];

// ── the predicate ────────────────────────────────────────────────────────────

Deno.test("scoring delegation - a built-in cost with no special semantics is eligible", () => {
  const decision = nativeDatasetScoringEligibility({
    costName: "MSE",
    forwardOnlyGuaranteed: true,
    feedbackLoop: false,
    outputRangeCount: 0,
  });
  assert(decision.eligible);
  assertEquals(decision.costName, "MSE");
});

Deno.test("scoring delegation - every built-in cost is recognised", () => {
  for (const name of ["MSE", "RMSE", "MAE", "MAPE", "MSLE", "HINGE"]) {
    assert(isBuiltInCostName(name), `${name} should be a built-in cost`);
  }
  assert(!isBuiltInCostName("MY_CUSTOM_COST"));
  assert(!isBuiltInCostName(""));
});

Deno.test("scoring delegation - a user-registered cost name is refused", () => {
  const decision = nativeDatasetScoringEligibility({
    costName: "MY_CUSTOM_COST",
    forwardOnlyGuaranteed: true,
    feedbackLoop: false,
    outputRangeCount: 0,
  });
  assert(!decision.eligible);
  assertEquals(decision.refusedBecause, "CUSTOM_COST");
});

Deno.test("scoring delegation - a configured customCost module is refused even though costName stays MSE", () => {
  // Issue #3776 keeps `NeatConfig.costName` at "MSE" when `customCost` is set,
  // so the name alone cannot reveal the custom cost.
  const decision = nativeDatasetScoringEligibility({
    costName: "MSE",
    customCostConfigured: true,
    forwardOnlyGuaranteed: true,
    feedbackLoop: false,
    outputRangeCount: 0,
  });
  assert(!decision.eligible);
  assertEquals(decision.refusedBecause, "CUSTOM_COST");
});

Deno.test("scoring delegation - configured outputRanges are refused", () => {
  const decision = nativeDatasetScoringEligibility({
    costName: "MSE",
    forwardOnlyGuaranteed: true,
    feedbackLoop: false,
    outputRangeCount: 1,
  });
  assert(!decision.eligible);
  assertEquals(decision.refusedBecause, "OUTPUT_RANGES");
});

Deno.test("scoring delegation - a recurrent creature with feedbackLoop is refused", () => {
  const decision = nativeDatasetScoringEligibility({
    costName: "MSE",
    forwardOnlyGuaranteed: false,
    feedbackLoop: true,
    outputRangeCount: 0,
  });
  assert(!decision.eligible);
  assertEquals(decision.refusedBecause, "FEEDBACK_LOOP");
});

Deno.test("scoring delegation - feedbackLoop on a forward-only creature is still eligible", () => {
  // A forward-only creature carries no state between records, so the flag
  // cannot change the result and the native engine agrees by construction.
  const decision = nativeDatasetScoringEligibility({
    costName: "MSE",
    forwardOnlyGuaranteed: true,
    feedbackLoop: true,
    outputRangeCount: 0,
  });
  assert(decision.eligible);
});

Deno.test("scoring delegation - a recurrent creature without feedbackLoop is eligible", () => {
  const decision = nativeDatasetScoringEligibility({
    costName: "MAE",
    forwardOnlyGuaranteed: false,
    feedbackLoop: false,
    outputRangeCount: 0,
  });
  assert(decision.eligible);
  assertEquals(decision.costName, "MAE");
});

// ── evaluateDir honours the predicate ────────────────────────────────────────

/** Count scoring invocations of the per-creature scorer (probes excluded). */
function countingRunner(counter: { scoreCalls: number }) {
  return (_command: string, args: string[]) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "--cost <NAME>",
        stderr: "",
      });
    }
    counter.scoreCalls++;
    return Promise.resolve({
      success: true,
      code: 0,
      // A value no TypeScript evaluation of this fixture can produce, so a
      // leaked delegation shows up in the returned error too.
      stdout: '{"error":42}',
      stderr: "",
    });
  };
}

const ENABLED_CONFIG: RequiredRustScorerConfig = {
  enabled: true,
  binaryPath: "rust_scorer",
  timeoutMs: 0,
  env: {},
  batch: false,
  strict: false,
};

async function evaluateWithCountingScorer(options: {
  selfLoop?: boolean;
  feedbackLoop?: boolean;
  outputRanges?: ReadonlyArray<RequiredOutputRange>;
  cost?: CostInterface;
}): Promise<{ error: number; scoreCalls: number }> {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  const counter = { scoreCalls: 0 };
  __setRustScorerRunnerForTests(countingRunner(counter));
  const dataDir = makeScoringDataDir(16);
  try {
    const creature = buildScoringCreature(options.selfLoop ?? false);
    const result = await creature.evaluateDir(
      dataDir,
      options.cost ?? Costs.find("MSE"),
      options.feedbackLoop ?? false,
      options.outputRanges,
      undefined,
      ENABLED_CONFIG,
    );
    return { error: result.error, scoreCalls: counter.scoreCalls };
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
}

Deno.test("evaluateDir - delegates a plain built-in cost to the native scorer", async () => {
  const { error, scoreCalls } = await evaluateWithCountingScorer({});
  assertEquals(scoreCalls, 1);
  assertEquals(error, 42, "the native result is used verbatim");
});

Deno.test("evaluateDir - never delegates when outputRanges are configured", async () => {
  const { error, scoreCalls } = await evaluateWithCountingScorer({
    outputRanges: RANGES,
  });
  assertEquals(
    scoreCalls,
    0,
    "rust_scorer has no output-range concept; delegating drops the penalty",
  );
  assert(error !== 42 && Number.isFinite(error));
});

Deno.test("evaluateDir - never delegates a recurrent creature with feedbackLoop", async () => {
  const { error, scoreCalls } = await evaluateWithCountingScorer({
    selfLoop: true,
    feedbackLoop: true,
  });
  assertEquals(
    scoreCalls,
    0,
    "the native recurrent path resets state per record — feedbackLoop=false",
  );
  assert(error !== 42 && Number.isFinite(error));
});

Deno.test("evaluateDir - still delegates a recurrent creature without feedbackLoop", async () => {
  const { scoreCalls } = await evaluateWithCountingScorer({
    selfLoop: true,
    feedbackLoop: false,
  });
  assertEquals(scoreCalls, 1);
});

Deno.test("evaluateDir - never delegates a user-registered custom cost", async () => {
  class DoubleAbsoluteError implements CostInterface {
    getName(): string {
      return "TEST_DOUBLE_ABS";
    }
    calculate(target: Float32Array, output: Float32Array): number {
      let sum = 0;
      for (let i = output.length; i--;) {
        sum += 2 * Math.abs(target[i] - output[i]);
      }
      return sum;
    }
  }
  const { error, scoreCalls } = await evaluateWithCountingScorer({
    cost: new DoubleAbsoluteError(),
  });
  assertEquals(scoreCalls, 0);
  assert(error !== 42 && Number.isFinite(error));
});

// ── Fitness batch mode honours the predicate ─────────────────────────────────

class MockWorkerHandler {
  public evaluateCallCount = 0;
  addIdleListener(_callback: () => void): void {}
  isBusy(): boolean {
    return false;
  }
  // deno-lint-ignore require-await
  async evaluate(): Promise<{ evaluate: { error: number } }> {
    this.evaluateCallCount++;
    return { evaluate: { error: 0.5 } };
  }
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
    const creature = Creature.fromJSON(forked);
    CreatureUtil.makeUUID(creature);
    creatures.push(creature);
  }
  return creatures;
}

async function runBatchFitness(
  fitnessFactory: (dataDir: string, worker: WorkerHandler) => Fitness,
): Promise<{ batchInvocations: number; workerCalls: number }> {
  __resetRustScorerBridgeForTests();
  __setRustScorerConfigForTests({ enabled: true, batch: true, strict: false });
  const population = buildForwardOnlyPopulation(3);
  let scoreCalls = 0;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "--cost <NAME>",
        stderr: "",
      });
    }
    scoreCalls++;
    const payload: Record<
      string,
      { score: number; error: number; recordCount: number }
    > = {};
    for (const creature of population) {
      payload[creature.uuid!] = { score: 0.9, error: 0.1, recordCount: 8 };
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
    });
  });
  const worker = new MockWorkerHandler();
  const dataDir = makeDataDir(buildScoringDataSet(8), 8);
  try {
    const fitness = fitnessFactory(dataDir, worker as unknown as WorkerHandler);
    await fitness.calculate(population);
    return {
      batchInvocations: scoreCalls,
      workerCalls: worker.evaluateCallCount,
    };
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
}

Deno.test("Fitness batch - configured outputRanges keep the generation on the worker path", async () => {
  const { batchInvocations, workerCalls } = await runBatchFitness(
    (dataDir, worker) =>
      new Fitness([worker], 0.0001, false, undefined, dataDir, "MSE", RANGES),
  );
  assertEquals(
    batchInvocations,
    0,
    "the batch scorer bypasses the workers that apply the range penalty",
  );
  assertEquals(workerCalls, 3);
});

Deno.test("Fitness batch - a configured customCost keeps the generation on the worker path", async () => {
  const { batchInvocations, workerCalls } = await runBatchFitness(
    (dataDir, worker) =>
      new Fitness(
        [worker],
        0.0001,
        false,
        undefined,
        dataDir,
        // Issue #3776: costName stays "MSE" while customCost owns evaluation.
        "MSE",
        undefined,
        true,
      ),
  );
  assertEquals(
    batchInvocations,
    0,
    "custom costs are never off-loaded (docs/api/COSTS_AND_ACTIVATIONS.md)",
  );
  assertEquals(workerCalls, 3);
});

Deno.test("Fitness batch - a plain built-in cost still batches", async () => {
  const { batchInvocations } = await runBatchFitness(
    (dataDir, worker) =>
      new Fitness([worker], 0.0001, false, undefined, dataDir, "MSE"),
  );
  assertEquals(batchInvocations, 1);
});
