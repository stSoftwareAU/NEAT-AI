/**
 * Tests for Issue #2745 — pass configured `costName` to `rust_scorer`
 * via `--cost <NAME>` so the native scorer computes the same cost as the
 * TS training loop.
 *
 * Covers:
 *   - per-creature bridge prepends `--cost <NAME>` when costName is supplied
 *     and the probed binary advertises the flag
 *   - per-creature bridge falls back to WASM (returns undefined) when the
 *     binary does not advertise `--cost` and the configured cost is non-MSE
 *   - custom (non-built-in) cost names are not off-loaded to the rust path
 *   - non-zero exit (e.g. rust hard-errors on an unknown cost) logs once and
 *     returns undefined
 *   - batch bridge prepends `--cost <NAME>` the same way
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Costs } from "@costs";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { CostInterface } from "@costs/CostInterface.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import { tryBatchScoreWithRustScorer } from "../../src/score/BatchRustScorerBridge.ts";
import {
  createConsoleLogger,
  getLogger,
  type Logger,
  setLogger,
} from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8;
    const b = (8 - i) / 8;
    rows.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([a > b ? 1 : -1]),
    });
  }
  return rows;
}

function captureWarnings(): { warnings: string[]; restore: () => void } {
  const warnings: string[] = [];
  const previous = getLogger();
  const capturing: Logger = {
    debug: () => {},
    info: () => {},
    warn: (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(" "));
    },
    error: () => {},
  };
  setLogger(capturing);
  return {
    warnings,
    restore: () => setLogger(previous ?? createConsoleLogger("info")),
  };
}

function buildConfig(): RequiredRustScorerConfig {
  return {
    enabled: true,
    binaryPath: "rust_scorer",
    timeoutMs: 0,
    env: {},
    batch: false,
  };
}

/** Help text that advertises `--cost` (clap-style). */
const HELP_WITH_COST =
  "USAGE:\n  rust_scorer [OPTIONS] <CREATURE> <DATA_DIR>\n\nOPTIONS:\n  --cost <NAME>    Cost function (MSE, MAE, ...)\n  -h, --help\n";

/** Help text from an older binary that does not advertise `--cost`. */
const HELP_WITHOUT_COST =
  "USAGE:\n  rust_scorer <CREATURE> <DATA_DIR>\n\nOPTIONS:\n  -h, --help\n";

Deno.test("RustScorerBridge: prepends --cost <NAME> when probe advertises the flag", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

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
      stdout: '{"error":0.42}',
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const result = await creature.evaluateDir(
      dataDir,
      Costs.find("MAE"),
      false,
      undefined,
      undefined,
      buildConfig(),
    );
    assertEquals(result.error, 0.42);
    assertEquals(scoreArgs[0], "--cost");
    assertEquals(scoreArgs[1], "MAE");
    // The remaining args are creature path + data dir.
    assertEquals(scoreArgs.length, 4);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: falls back to WASM when probe lacks --cost and cost is non-MSE", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let scoreCalls = 0;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: HELP_WITHOUT_COST,
        stderr: "",
      });
    }
    scoreCalls++;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: '{"error":0}',
      stderr: "",
    });
  });

  const { warnings, restore } = captureWarnings();

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    // MAE is non-MSE → bridge must skip the rust path entirely.
    const result = await creature.evaluateDir(
      dataDir,
      Costs.find("MAE"),
      false,
      undefined,
      undefined,
      buildConfig(),
    );
    assert(Number.isFinite(result.error));
    assertEquals(
      scoreCalls,
      0,
      "scorer must not be invoked when --cost is unsupported and cost is non-MSE",
    );
    const warned = warnings.find((w) =>
      w.includes("does not advertise --cost")
    );
    assert(
      warned !== undefined,
      `expected one-shot warning; got: ${warnings.join("\n")}`,
    );
  } finally {
    restore();
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: still uses rust path for MSE when probe lacks --cost", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let scoreArgs: string[] = [];
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: HELP_WITHOUT_COST,
        stderr: "",
      });
    }
    scoreArgs = args;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: '{"error":0.07}',
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const result = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      buildConfig(),
    );
    assertEquals(result.error, 0.07);
    // No `--cost` flag — falls back to positional invocation (MSE is the
    // binary's historical default so the call is still safe).
    assertEquals(
      scoreArgs.length,
      2,
      `expected positional args only; got ${JSON.stringify(scoreArgs)}`,
    );
    assertEquals(scoreArgs[0].endsWith(".json"), true);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: custom (registered) cost bypasses the rust path entirely", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  // Register a custom cost that mimics MSE so WASM scoring still works.
  class CustomMSE implements CostInterface {
    getName(): string {
      return "ISSUE_2745_CUSTOM_COST";
    }
    calculate(target: ArrayLike<number>, output: ArrayLike<number>): number {
      let s = 0;
      for (let i = 0; i < target.length; i++) {
        const d = target[i] - output[i];
        s += d * d;
      }
      return s / target.length;
    }
    propagate(target: number, output: number): number {
      return output - target;
    }
  }
  const custom = new CustomMSE();
  Costs.registerCustomCost(custom);

  let totalRustCalls = 0;
  __setRustScorerRunnerForTests(() => {
    totalRustCalls++;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: HELP_WITH_COST,
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const result = await creature.evaluateDir(
      dataDir,
      custom,
      false,
      undefined,
      undefined,
      buildConfig(),
    );
    assert(Number.isFinite(result.error));
    // The rust runner must not be invoked at all — neither probe nor score —
    // because custom costs cannot be off-loaded to the binary.
    assertEquals(
      totalRustCalls,
      0,
      "rust runner must not be invoked for custom costs",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: non-zero exit on unknown cost logs once and falls back", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let scoreCalls = 0;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: HELP_WITH_COST,
        stderr: "",
      });
    }
    scoreCalls++;
    return Promise.resolve({
      success: false,
      code: 2,
      stdout: "",
      stderr: "Error: unknown cost function: HINGE",
    });
  });

  const { warnings, restore } = captureWarnings();

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    // First call — should log warning and fall back to WASM.
    const result1 = await creature.evaluateDir(
      dataDir,
      Costs.find("HINGE"),
      false,
      undefined,
      undefined,
      buildConfig(),
    );
    assert(Number.isFinite(result1.error));
    // Second call — should not log again (one-shot behaviour).
    const result2 = await creature.evaluateDir(
      dataDir,
      Costs.find("HINGE"),
      false,
      undefined,
      undefined,
      buildConfig(),
    );
    assert(Number.isFinite(result2.error));

    assert(
      scoreCalls >= 1,
      `expected at least one scorer invocation; got ${scoreCalls}`,
    );
    const failures = warnings.filter((w) =>
      w.includes("Rust scorer call failed")
    );
    assertEquals(
      failures.length,
      1,
      `expected exactly one failure warning across both calls; got: ${
        warnings.join("\n")
      }`,
    );
  } finally {
    restore();
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer: prepends --cost <NAME> when probe advertises the flag", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

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
        "creature-aa": { score: 0.5, error: 0.5, recordCount: 8 },
      }),
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.uuid = "creature-aa";
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      {
        enabled: true,
        binaryPath: "rust_scorer",
        timeoutMs: 0,
        env: {},
        batch: true,
      },
      "MAE",
    );
    assertEquals(run.invocations, 1);
    assert(run.results !== undefined);
    assertEquals(scoreArgs[0], "--cost");
    assertEquals(scoreArgs[1], "MAE");
    // Remaining args are creatures dir + data dir.
    assertEquals(scoreArgs.length, 4);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("BatchRustScorer: falls back when probe lacks --cost and cost is non-MSE", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let scoreCalls = 0;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: HELP_WITHOUT_COST,
        stderr: "",
      });
    }
    scoreCalls++;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: "{}",
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.uuid = "creature-bb";
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [creature],
      dataDir,
      {
        enabled: true,
        binaryPath: "rust_scorer",
        timeoutMs: 0,
        env: {},
        batch: true,
      },
      "MAE",
    );
    assertEquals(run.results, undefined);
    assertEquals(run.invocations, 0);
    assertEquals(scoreCalls, 0);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
