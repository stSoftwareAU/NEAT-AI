import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { Costs } from "@costs";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import { initWasmForTests } from "../_initWasm.ts";

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

Deno.test("Rust scorer integration: disabled path does not invoke scorer", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let commandCount = 0;
  __setRustScorerRunnerForTests(() => {
    commandCount++;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: '{"error":0.01}',
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    const result = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      {
        enabled: false,
        binaryPath: "rust_scorer",
        timeoutMs: 0,
        env: {},
      },
    );
    assert(Number.isFinite(result.error));
    assertEquals(commandCount, 0);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Rust scorer integration: unavailable scorer probes once then falls back", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  let probeCount = 0;
  __setRustScorerRunnerForTests((command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      probeCount++;
    }
    return Promise.reject(new Error(`missing scorer: ${command}`));
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
    const cfg = {
      enabled: true,
      binaryPath: "rust_scorer_missing",
      timeoutMs: 0,
      env: {},
    };
    const a = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      cfg,
    );
    const b = await creature.evaluateDir(
      dataDir,
      Costs.find("MSE"),
      false,
      undefined,
      undefined,
      cfg,
    );
    assert(Number.isFinite(a.error));
    assert(Number.isFinite(b.error));
    assertEquals(probeCount, 1);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Rust scorer integration: uses scorer error when available", async () => {
  __resetRustScorerBridgeForTests();

  let scoreCalls = 0;
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    scoreCalls++;
    return Promise.resolve({
      success: true,
      code: 0,
      stdout: '{"error":0.12345}',
      stderr: "",
    });
  });

  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const dataDir = makeDataDir(buildDataSet(), 24);
  try {
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
    assertEquals(result.error, 0.12345);
    assertEquals(scoreCalls, 1);
  } finally {
    await Deno.remove(dataDir, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
