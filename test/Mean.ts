import { assertThrows } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureExport } from "../mod.ts";
import { emptyDirSync } from "@std/fs";
import { initWasmActivation } from "../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});
const testDir = ".test/Mean";
emptyDirSync(testDir);

/**
 * Issue #1123: WASM Migration Phase 6 - MEAN is a deprecated squash function
 * that is not supported by WASM activation. This test verifies that activation
 * correctly throws an error for creatures using deprecated squash functions.
 */
Deno.test("Mean - activation throws for deprecated squash", () => {
  const json: CreatureExport = {
    neurons: [
      { bias: -0.2, type: "output", squash: "MEAN", uuid: "output-0" },
    ],
    synapses: [
      { weight: 1, fromUUID: "input-0", toUUID: "output-0" },
      { weight: -1, fromUUID: "input-1", toUUID: "output-0" },
      { weight: 1, fromUUID: "input-2", toUUID: "output-0" },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  creature.fix();
  creature.validate();
  Deno.writeTextFileSync(
    `${testDir}/fixed.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  const data = new Float32Array([0.5, 0.3, -0.2]);

  // MEAN is a deprecated squash function not supported by WASM.
  // Activation should throw an error indicating WASM cannot handle it.
  assertThrows(
    () => creature.activate(data),
    Error,
    "WASM activation is not available",
  );
});
