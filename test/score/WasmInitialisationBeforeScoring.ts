/**
 * Issue #1247 - WASM activation is required but not initialised
 *
 * Tests that verify WASM is automatically initialised before scoring/evaluation
 * begins, ensuring calling programs don't need to explicitly initialise WASM
 * before using scoreDir() or evaluateDir().
 */
import { assert, assertGreater } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { isWasmActivationAvailable } from "../../src/wasm/mod.ts";
import { ensureWasmActivation } from "../../src/wasm/EnsureWasmActivation.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";

/**
 * Tests that ensureWasmActivation initialises WASM when not already available
 */
Deno.test({
  name: "Issue #1247: ensureWasmActivation initialises WASM when not available",
  async fn() {
    await ensureWasmActivation();
    assert(
      isWasmActivationAvailable(),
      "WASM should be available after ensureWasmActivation()",
    );
  },
});

/**
 * Tests that ensureWasmActivation is idempotent
 */
Deno.test({
  name: "Issue #1247: ensureWasmActivation is idempotent",
  async fn() {
    await ensureWasmActivation();
    assert(isWasmActivationAvailable(), "WASM available after first call");

    await ensureWasmActivation();
    assert(isWasmActivationAvailable(), "WASM available after second call");
  },
});

/**
 * Tests that scoreDir auto-initialises WASM and succeeds
 */
Deno.test({
  name: "Issue #1247: scoreDir auto-initialises WASM and returns valid score",
  async fn() {
    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });

    const dataSet: DataRecordInterface[] = [];
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * 2 - 1;
      const b = Math.random() * 2 - 1;
      dataSet.push({
        input: new Float32Array([a, b]),
        output: new Float32Array([a + b > 0 ? 1 : -1]),
      });
    }

    const dataSetDir = makeDataDir(dataSet, dataSet.length);
    try {
      const result = await creature.scoreDir(dataSetDir, {});
      assert(
        Number.isFinite(result.score),
        `Score should be finite, got: ${result.score}`,
      );
      assert(
        Number.isFinite(result.error),
        `Error should be finite, got: ${result.error}`,
      );
      assertGreater(
        result.error,
        0,
        "Error should be greater than zero for an untrained creature",
      );
    } finally {
      await Deno.remove(dataSetDir, { recursive: true });
    }
  },
});

/**
 * Tests that evaluateDir auto-initialises WASM and succeeds
 */
Deno.test({
  name:
    "Issue #1247: evaluateDir auto-initialises WASM and returns valid error",
  async fn() {
    const { Costs } = await import("../../src/Costs.ts");
    const creature = new Creature(2, 1, {
      layers: [{ count: 2 }],
    });

    const dataSet: DataRecordInterface[] = [];
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * 2 - 1;
      const b = Math.random() * 2 - 1;
      dataSet.push({
        input: new Float32Array([a, b]),
        output: new Float32Array([a + b > 0 ? 1 : -1]),
      });
    }

    const dataSetDir = makeDataDir(dataSet, dataSet.length);
    try {
      const result = await creature.evaluateDir(
        dataSetDir,
        Costs.find("MSE"),
        false,
      );
      assert(
        Number.isFinite(result.error),
        `Error should be finite, got: ${result.error}`,
      );
      assertGreater(
        result.error,
        0,
        "Error should be greater than zero for an untrained creature",
      );
    } finally {
      await Deno.remove(dataSetDir, { recursive: true });
    }
  },
});
