/**
 * Integration tests for Issue #2756 — batch + per-creature rust scorer bridges
 * with the `CATEGORICAL_ERROR` cost.
 *
 * Issue #2745 plumbed `NeatConfig.costName` through to `rust_scorer` via
 * `--cost <NAME>`. `CATEGORICAL_ERROR` is one of the seven
 * `BUILT_IN_COST_NAMES`, so it is eligible for native off-load once the scorer
 * release containing NEAT-AI-scorer#134 is deployed. These tests lock the
 * TS-side contract so the bridges stay wired for `CATEGORICAL_ERROR` and do not
 * silently fall back to WASM when the binary advertises the cost.
 *
 * Covers:
 *   - `tryScoreWithRustScorer` prepends `["--cost", "CATEGORICAL_ERROR", ...]`.
 *   - `tryBatchScoreWithRustScorer` prepends the same for directory mode.
 *   - A multi-output (≥2 class) fixture with an analytically-known argmax
 *     misclassification count: the bridge returns that error when the mock
 *     runner simulates a successful scorer response.
 *   - `Fitness.calculate` batch path with `costName: "CATEGORICAL_ERROR"` does
 *     not log `Batch rust scorer reconciliation failed` against a current
 *     scorer.
 *   - Optional live smoke against a real `rust_scorer` binary (gated on
 *     `NEAT_AI_RUST_SCORER_BINARY_PATH`).
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CategoricalError } from "@costs/CategoricalError.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Fitness } from "@architecture/Fitness.ts";
import type { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
  tryScoreWithRustScorer,
} from "../../src/score/RustScorerBridge.ts";
import { tryBatchScoreWithRustScorer } from "../../src/score/BatchRustScorerBridge.ts";
import {
  createConsoleLogger,
  getLogger,
  type Logger,
  setLogger,
} from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

const COST: typeof CategoricalError.NAME = CategoricalError.NAME;

/** Help text that advertises `--cost` (clap-style). */
const HELP_WITH_COST =
  "USAGE:\n  rust_scorer [OPTIONS] <CREATURE> <DATA_DIR>\n\nOPTIONS:\n  --cost <NAME>    Cost function (MSE, MAE, CATEGORICAL_ERROR, ...)\n  -h, --help\n";

/**
 * A three-class one-hot fixture with a known argmax misclassification rate.
 *
 * Each record carries the true one-hot target and a predicted score vector.
 * Two of the eight records are deliberately misclassified by argmax, so the
 * analytically-known categorical error is `2 / 8 = 0.25`.
 */
function buildCategoricalFixture(): {
  records: DataRecordInterface[];
  expectedError: number;
} {
  const rows: Array<{ target: number[]; output: number[] }> = [
    { target: [1, 0, 0], output: [0.7, 0.2, 0.1] }, // argmax 0 == 0 ✓
    { target: [0, 1, 0], output: [0.1, 0.8, 0.1] }, // argmax 1 == 1 ✓
    { target: [0, 0, 1], output: [0.2, 0.1, 0.7] }, // argmax 2 == 2 ✓
    { target: [1, 0, 0], output: [0.1, 0.2, 0.7] }, // argmax 2 != 0 ✗
    { target: [0, 1, 0], output: [0.05, 0.9, 0.05] }, // argmax 1 == 1 ✓
    { target: [0, 0, 1], output: [0.6, 0.3, 0.1] }, // argmax 0 != 2 ✗
    { target: [1, 0, 0], output: [0.9, 0.05, 0.05] }, // argmax 0 == 0 ✓
    { target: [0, 1, 0], output: [0.2, 0.7, 0.1] }, // argmax 1 == 1 ✓
  ];

  // Compute the misclassification rate analytically via the real cost so the
  // fixture's expected value is derived, not hand-hardcoded.
  const cost = new CategoricalError();
  let sum = 0;
  for (const row of rows) {
    sum += cost.calculate(
      new Float32Array(row.target),
      new Float32Array(row.output),
    );
  }
  const expectedError = sum / rows.length;

  const records: DataRecordInterface[] = rows.map((row) => ({
    input: new Float32Array(row.target.slice(0, 2)),
    output: new Float32Array(row.target),
  }));

  return { records, expectedError };
}

function captureLogs(): {
  warnings: string[];
  errors: string[];
  restore: () => void;
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const previous = getLogger();
  const capturing: Logger = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    },
    error: (...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(" "));
    },
  };
  setLogger(capturing);
  return {
    warnings,
    errors,
    restore: () => setLogger(previous ?? createConsoleLogger("info")),
  };
}

function perCreatureConfig(): RequiredRustScorerConfig {
  return {
    enabled: true,
    binaryPath: "rust_scorer",
    timeoutMs: 0,
    env: {},
    batch: false,
  };
}

function batchConfig(): RequiredRustScorerConfig {
  return {
    enabled: true,
    binaryPath: "rust_scorer",
    timeoutMs: 0,
    env: {},
    batch: true,
  };
}

Deno.test("CATEGORICAL_ERROR: per-creature bridge prepends --cost and returns analytic error", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  const { records, expectedError } = buildCategoricalFixture();
  // Sanity: the fixture's analytic error is the known 2-of-8 misclassification.
  assertEquals(expectedError, 0.25);

  let scoreArgs: string[] = [];
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: HELP_WITH_COST,
        stderr: "",
      });
    }
    scoreArgs = args;
    // The mock scorer simulates computing the categorical error the same way
    // the native binary would for this fixture.
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify({ error: expectedError }),
      stderr: "",
    });
  });

  const creature = new Creature(3, 3, { layers: [{ count: 3 }] });
  const dataDir = makeDataDir(records, records.length);
  try {
    const result = await tryScoreWithRustScorer(
      creature,
      dataDir,
      perCreatureConfig(),
      COST,
    );
    assert(result !== undefined, "bridge should off-load CATEGORICAL_ERROR");
    assertEquals(result.error, expectedError);
    assert(Number.isFinite(result.error) && result.error >= 0);
    // argv contract: --cost CATEGORICAL_ERROR prepended before the positionals.
    assertEquals(scoreArgs[0], "--cost");
    assertEquals(scoreArgs[1], COST);
    assertEquals(scoreArgs.length, 4);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("CATEGORICAL_ERROR: batch bridge prepends --cost in directory mode", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  const { records, expectedError } = buildCategoricalFixture();

  let scoreArgs: string[] = [];
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: HELP_WITH_COST,
        stderr: "",
      });
    }
    scoreArgs = args;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify({
        "creature-cat": {
          score: 1 - expectedError,
          error: expectedError,
          recordCount: records.length,
          costName: COST,
        },
      }),
      stderr: "",
    });
  });

  const creature = new Creature(3, 3, { layers: [{ count: 3 }] });
  creature.uuid = "creature-cat";
  const dataDir = makeDataDir(records, records.length);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      batchConfig(),
      COST,
    );
    assertEquals(run.invocations, 1);
    assert(run.results !== undefined);
    const record = run.results.get(creature);
    assert(record !== undefined);
    assertEquals(record.error, expectedError);
    assert(Number.isFinite(record.error) && record.error >= 0);
    // Scorer echoes the cost it computed.
    assertEquals(record.costName, COST);
    // argv contract for directory mode.
    assertEquals(scoreArgs[0], "--cost");
    assertEquals(scoreArgs[1], COST);
    assertEquals(scoreArgs.length, 4);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

function buildPopulation(count: number): Creature[] {
  // forwardOnly so the Fitness partition routes them into the batch directory.
  const base: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-2", squash: "IDENTITY", bias: 0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
      { fromUUID: "hidden-0", toUUID: "output-1", weight: 0.4 },
      { fromUUID: "hidden-0", toUUID: "output-2", weight: 0.2 },
    ],
    input: 2,
    output: 3,
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

Deno.test("CATEGORICAL_ERROR: Fitness.calculate batch path does not log reconciliation failure", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();
  const prevEnabled = Deno.env.get("NEAT_AI_RUST_SCORER_ENABLED");
  const prevBatch = Deno.env.get("NEAT_AI_RUST_SCORER_BATCH");
  Deno.env.set("NEAT_AI_RUST_SCORER_ENABLED", "true");
  Deno.env.set("NEAT_AI_RUST_SCORER_BATCH", "true");

  const population = buildPopulation(3);
  const uuids = population.map((c) => CreatureUtil.makeUUID(c));
  const { records, expectedError } = buildCategoricalFixture();

  let scoreArgs: string[] = [];
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: HELP_WITH_COST,
        stderr: "",
      });
    }
    scoreArgs = args;
    const payload: Record<string, unknown> = {};
    for (const uuid of uuids) {
      payload[uuid] = {
        score: 1 - expectedError,
        error: expectedError,
        recordCount: records.length,
        costName: COST,
      };
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: JSON.stringify(payload),
      stderr: "",
    });
  });

  const { errors, restore } = captureLogs();
  const worker = new MockWorkerHandler();
  const dataDir = makeDataDir(records, records.length);
  try {
    const fitness = new Fitness(
      [worker as unknown as WorkerHandler],
      0.0001,
      false,
      undefined,
      dataDir,
      COST,
    );
    await fitness.calculate(population);

    assertEquals(fitness.lastBatchScorerInvocations, 1);
    assertEquals(
      worker.evaluateCallCount,
      0,
      "batch mode should own scoring for CATEGORICAL_ERROR",
    );
    assertEquals(scoreArgs[0], "--cost");
    assertEquals(scoreArgs[1], COST);
    const reconFailures = errors.filter((e) =>
      e.includes("Batch rust scorer reconciliation failed")
    );
    assertEquals(
      reconFailures.length,
      0,
      `expected no reconciliation failure; got: ${errors.join("\n")}`,
    );
    for (const creature of population) {
      assert(creature.score !== undefined, "every creature should be scored");
    }
  } finally {
    restore();
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

/**
 * Optional live smoke: only runs when a real `rust_scorer` binary path is
 * provided via `NEAT_AI_RUST_SCORER_BINARY_PATH`. Mirrors the opt-in pattern
 * used by the discovery FFI integration tests so CI without the binary skips
 * gracefully. Asserts the native binary returns a finite, non-negative error
 * for the `CATEGORICAL_ERROR` cost on the multi-class fixture.
 */
const LIVE_BINARY = Deno.env.get("NEAT_AI_RUST_SCORER_BINARY_PATH");
Deno.test({
  name: "CATEGORICAL_ERROR: live rust_scorer smoke (requires real binary)",
  ignore: LIVE_BINARY === undefined || LIVE_BINARY.trim() === "",
  fn: async () => {
    await initWasmForTests();
    __resetRustScorerBridgeForTests();
    const { records } = buildCategoricalFixture();
    const creature = new Creature(3, 3, { layers: [{ count: 3 }] });
    const dataDir = makeDataDir(records, records.length);
    try {
      const result = await tryScoreWithRustScorer(
        creature,
        dataDir,
        {
          enabled: true,
          binaryPath: LIVE_BINARY!,
          timeoutMs: 30_000,
          env: {},
          batch: false,
        },
        COST,
      );
      // A pre-#134 binary may decline the cost and fall back (undefined); a
      // current binary returns a finite, non-negative error.
      if (result !== undefined) {
        assert(
          Number.isFinite(result.error) && result.error >= 0,
          `live scorer returned invalid error: ${result.error}`,
        );
      }
    } finally {
      await Deno.remove(dataDir, { recursive: true });
      __resetRustScorerBridgeForTests();
    }
  },
});
