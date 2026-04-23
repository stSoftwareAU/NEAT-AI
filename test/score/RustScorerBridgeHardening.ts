import { assert, assertEquals } from "@std/assert";
import { isAbsolute } from "@std/path";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { Costs } from "@costs";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import {
  createConsoleLogger,
  getLogger,
  type Logger,
  setLogger,
} from "@utils/Logger.ts";
import { initWasmForTests } from "../_initWasm.ts";

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

function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 24; i++) {
    const a = i / 24;
    const b = (24 - i) / 24;
    rows.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([a > b ? 1 : -1]),
    });
  }
  return rows;
}

Deno.test("RustScorerBridge: inherits parent env when no overrides configured", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let scoreEnv: Record<string, string> | undefined = { SENTINEL: "unset" };
  __setRustScorerRunnerForTests((_command, args, options) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    scoreEnv = options.env;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: '{"error":0.1}',
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      {
        enabled: true,
        binaryPath: "rust_scorer",
        timeoutMs: 0,
        env: {},
      },
    );
    // env should be undefined when no overrides exist → child inherits parent env.
    assertEquals(
      scoreEnv,
      undefined,
      "runner should be invoked without env when no overrides are provided",
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: merges overrides with parent env when overrides exist", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  const sentinelKey = "NEAT_AI_RUST_SCORER_TEST_PARENT_SENTINEL";
  Deno.env.set(sentinelKey, "present");

  let scoreEnv: Record<string, string> | undefined;
  __setRustScorerRunnerForTests((_command, args, options) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    scoreEnv = options.env;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: '{"error":0.1}',
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      {
        enabled: true,
        binaryPath: "rust_scorer",
        timeoutMs: 0,
        env: { OVERRIDE_KEY: "override_value" },
      },
    );
    assert(scoreEnv !== undefined, "runner should receive merged env");
    assertEquals(scoreEnv!.OVERRIDE_KEY, "override_value");
    assertEquals(
      scoreEnv![sentinelKey],
      "present",
      "merged env should include the parent process env",
    );
  } finally {
    Deno.env.delete(sentinelKey);
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: resolves creature and data paths to absolute paths", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let seenArgs: string[] = [];
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    seenArgs = args;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: '{"error":0.5}',
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  // makeDataDir returns an absolute path - make a relative alias for the test.
  const dataDir = makeDataDir(buildDataSet(), 24);
  const cwd = Deno.cwd();
  const relative = dataDir.startsWith(cwd + "/")
    ? dataDir.slice(cwd.length + 1)
    : dataDir;
  try {
    await creature.evaluateDir(
      relative,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      {
        enabled: true,
        binaryPath: "rust_scorer",
        timeoutMs: 0,
        env: {},
      },
    );
    assertEquals(seenArgs.length, 2);
    assert(
      isAbsolute(seenArgs[0]),
      `creature path should be absolute; got ${seenArgs[0]}`,
    );
    assert(
      isAbsolute(seenArgs[1]),
      `data dir should be absolute; got ${seenArgs[1]}`,
    );
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: logs trimmed stderr on non-zero exit", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  __setRustScorerRunnerForTests((_command, args) => {
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
      code: 2,
      stdout: "",
      stderr: "Error: synthetic scorer failure for test",
    });
  });

  const { warnings, restore } = captureWarnings();

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      {
        enabled: true,
        binaryPath: "rust_scorer",
        timeoutMs: 0,
        env: {},
      },
    );
    const failureWarning = warnings.find((w) =>
      w.includes("Rust scorer call failed")
    );
    assert(
      failureWarning !== undefined,
      "warn log should include failure message",
    );
    assert(
      failureWarning!.includes("synthetic scorer failure for test"),
      `warn should contain trimmed stderr; got: ${failureWarning}`,
    );
  } finally {
    restore();
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("RustScorerBridge: handles non-JSON stdout gracefully and includes stderr in warning", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: "not valid json at all",
      stderr: "Warning: deprecated flag",
    });
  });

  const { warnings, restore } = captureWarnings();

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    // Must not throw - should fall back to WASM scoring.
    const result = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      {
        enabled: true,
        binaryPath: "rust_scorer",
        timeoutMs: 0,
        env: {},
      },
    );
    assert(Number.isFinite(result.error));
    const parseWarning = warnings.find((w) =>
      w.includes("Rust scorer") && w.includes("invalid")
    );
    assert(
      parseWarning !== undefined,
      `should warn on invalid stdout; got warnings: ${warnings.join("\n")}`,
    );
  } finally {
    restore();
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
