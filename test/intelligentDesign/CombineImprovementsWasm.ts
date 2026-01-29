/**
 * Issue #1250 - WASM activation is required but not initialised
 *
 * Tests that combineImprovements() correctly auto-initialises WASM activation
 * when scoring combined creatures. This exercises the real scoreDir/evaluateDir
 * path (not stubbed) to confirm that WASM is initialised before
 * requireWasmOrThrow() is called.
 *
 * The original bug occurred when combineImprovements() called scoreDir() which
 * called evaluateDir() which called requireWasmOrThrow() without first ensuring
 * WASM was initialised.
 */

import { assert, assertExists } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { combineImprovements } from "../../src/intelligentDesign/ImproveSquash.ts";
import { makeDataDir } from "../../src/architecture/DataSet.ts";
import type { DataRecordInterface } from "../../src/architecture/DataSet.ts";
import type { BestNeuronSquash } from "../../src/intelligentDesign/BestNeuronSquash.ts";

const TEST_DIR = ".test-combine-improvements-wasm";

function cleanup() {
  try {
    Deno.removeSync(TEST_DIR, { recursive: true });
  } catch {
    // Ignore cleanup errors.
  }
}

/**
 * Generate a simple dataset for scoring.
 */
function makeSimpleDataSet(): DataRecordInterface[] {
  const dataSet: DataRecordInterface[] = [];
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * 2 - 1;
    const b = Math.random() * 2 - 1;
    dataSet.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([a + b > 0 ? 1 : -1]),
    });
  }
  return dataSet;
}

Deno.test({
  name:
    "Issue #1250: combineImprovements auto-initialises WASM and scores without error",
  async fn() {
    cleanup();
    let dataSetDir: string | undefined;
    try {
      await Deno.mkdir(TEST_DIR, { recursive: true });

      // Create a creature with multiple hidden neurons so we can combine
      // improvements across them.
      const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
      const exported = creature.exportJSON();

      const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
      assert(
        hiddenNeurons.length >= 2,
        "Need at least 2 hidden neurons for combine test",
      );
      const firstHidden = hiddenNeurons[0];
      const secondHidden = hiddenNeurons[1];
      assertExists(firstHidden.uuid, "First hidden neuron should have UUID");
      assertExists(secondHidden.uuid, "Second hidden neuron should have UUID");

      // Write improvement files (the creature JSON that would be loaded for
      // the single-improvement fallback path).
      const pathA = `${TEST_DIR}/a.json`;
      const pathB = `${TEST_DIR}/b.json`;
      await Deno.writeTextFile(pathA, JSON.stringify(exported, null, 1));
      await Deno.writeTextFile(pathB, JSON.stringify(exported, null, 1));

      // Create a real dataset directory for scoring.
      const dataSet = makeSimpleDataSet();
      dataSetDir = makeDataDir(dataSet, dataSet.length);

      const improvements = new Map<string, BestNeuronSquash>();
      improvements.set(firstHidden.uuid, {
        squash: "GELU",
        score: -Infinity,
        path: pathA,
        message: "A: LOGISTIC -> GELU",
      });
      improvements.set(secondHidden.uuid, {
        squash: "Swish",
        score: -Infinity,
        path: pathB,
        message: "B: LOGISTIC -> Swish",
      });

      // This is the exact code path from issue #1250:
      // combineImprovements → scoreDir → evaluateDir → ensureWasmActivation
      // Before the fix, this would throw:
      // "WASM activation is required but not initialised"
      const result = await combineImprovements(
        exported,
        improvements,
        dataSetDir,
        -Infinity,
      );

      assertExists(result.creature, "Should return a creature");
      assert(
        typeof result.message === "string" && result.message.length > 0,
        "Should return a message",
      );
    } finally {
      cleanup();
      if (dataSetDir) {
        try {
          await Deno.remove(dataSetDir, { recursive: true });
        } catch {
          // Ignore cleanup errors.
        }
      }
    }
  },
});

Deno.test({
  name:
    "Issue #1250: combineImprovements fallback path works with real WASM scoring",
  async fn() {
    cleanup();
    let dataSetDir: string | undefined;
    try {
      await Deno.mkdir(TEST_DIR, { recursive: true });

      const creature = new Creature(2, 1, { layers: [{ count: 3 }] });
      const exported = creature.exportJSON();

      const hiddenNeurons = exported.neurons.filter((n) => n.type === "hidden");
      assert(
        hiddenNeurons.length >= 2,
        "Need at least 2 hidden neurons for combine test",
      );
      const firstHidden = hiddenNeurons[0];
      const secondHidden = hiddenNeurons[1];
      assertExists(firstHidden.uuid);
      assertExists(secondHidden.uuid);

      const pathA = `${TEST_DIR}/best.json`;
      const pathB = `${TEST_DIR}/worst.json`;
      await Deno.writeTextFile(pathA, JSON.stringify(exported, null, 1));
      await Deno.writeTextFile(pathB, JSON.stringify(exported, null, 1));

      // Create a real dataset for scoring.
      const dataSet = makeSimpleDataSet();
      dataSetDir = makeDataDir(dataSet, dataSet.length);

      const improvements = new Map<string, BestNeuronSquash>();
      improvements.set(firstHidden.uuid, {
        squash: "GELU",
        score: Infinity, // Force fallback — combined score cannot beat Infinity
        path: pathA,
        message: "best",
      });
      improvements.set(secondHidden.uuid, {
        squash: "Swish",
        score: Infinity - 1,
        path: pathB,
        message: "worse",
      });

      // The combined score won't beat Infinity, so the fallback path is used.
      // This still exercises scoreDir → evaluateDir → ensureWasmActivation.
      const result = await combineImprovements(
        exported,
        improvements,
        dataSetDir,
        -Infinity,
      );

      assertExists(result.creature, "Should return a creature");
      assert(
        typeof result.message === "string",
        "Should return a message",
      );
      // Fallback uses the best individual.
      assert(
        result.message.includes("Marriage failed"),
        `Expected fallback message, got: ${result.message}`,
      );
    } finally {
      cleanup();
      if (dataSetDir) {
        try {
          await Deno.remove(dataSetDir, { recursive: true });
        } catch {
          // Ignore cleanup errors.
        }
      }
    }
  },
});
