import { assertThrows } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { initWasmActivation } from "../src/wasm/WasmActivation.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

/**
 * Issue #1123: WASM Migration Phase 6 - HYPOT is a deprecated squash function
 * that is not supported by WASM activation. This test verifies that activation
 * correctly throws an error for creatures using deprecated squash functions.
 */
Deno.test("Hypot - activation throws for deprecated squash", () => {
  const json: CreatureInternal = {
    neurons: [
      { bias: 0, type: "input", squash: "LOGISTIC", index: 0 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 1 },
      { bias: 0, type: "input", squash: "LOGISTIC", index: 2 },
      { bias: 0, type: "output", squash: "HYPOT", index: 3 },
    ],
    synapses: [
      { weight: 1, from: 0, to: 3 },
      { weight: 1, from: 1, to: 3 },
      { weight: 1, from: 2, to: 3 },
    ],
    input: 3,
    output: 1,
  };
  const creature = Creature.fromJSON(json);

  const data = new Float32Array([0.5, 0.3, -0.2]);

  // HYPOT is a deprecated squash function not supported by WASM.
  // Activation should throw an error indicating WASM cannot handle it.
  assertThrows(
    () => creature.activate(data),
    Error,
    "WASM activation is not available",
  );
});
