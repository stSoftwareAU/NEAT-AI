import { assertThrows } from "@std/assert";
import { ensureDirSync } from "@std/fs";
import type { CreatureExport } from "../../mod.ts";
import { Creature } from "../../src/Creature.ts";
import { initWasmActivation } from "../../src/wasm/WasmActivation.ts";

// Get the project root directory for WASM module path
const projectRoot = new URL("../..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

Deno.test("WASM Initialisation", async () => {
  await initWasmActivation(wasmPath);
});

function makeCreature() {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "bipolar-3", squash: "BIPOLAR", bias: 0.1 },
      { type: "hidden", uuid: "cosine-4", squash: "Cosine", bias: -0.1 },
      { type: "hidden", uuid: "absolute-5", squash: "ABSOLUTE", bias: 0.2 },
      { type: "hidden", uuid: "mean-6", squash: "MEAN", bias: -0.2 },

      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-0",
        bias: 1,
      },
      {
        type: "output",
        squash: "IDENTITY",
        uuid: "output-1",
        bias: 0,
      },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "bipolar-3", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "absolute-5", weight: -1.1 },
      {
        fromUUID: "input-0",
        toUUID: "cosine-4",
        weight: -0.3,
      },
      { fromUUID: "cosine-4", toUUID: "mean-6", weight: 0.3 },
      {
        fromUUID: "bipolar-3",
        toUUID: "mean-6",
        weight: -0.3,
      },
      {
        fromUUID: "absolute-5",
        toUUID: "mean-6",
        weight: 0.3,
      },
      { fromUUID: "mean-6", toUUID: "output-0", weight: 0.6 },
      {
        fromUUID: "input-1",
        toUUID: "mean-6",
        weight: 0.35,
      },

      { fromUUID: "cosine-4", toUUID: "output-1", weight: 0.7 },
      { fromUUID: "input-2", toUUID: "output-1", weight: 0.8 },
    ],
    input: 3,
    output: 2,
  };
  const creature = Creature.fromJSON(json);
  creature.validate();

  return creature;
}

/**
 * Issue #1123: WASM Migration Phase 6 - MEAN is a deprecated squash function
 * that is not supported by WASM activation. This test verifies that activation
 * correctly throws an error for creatures using deprecated squash functions.
 */
Deno.test("PropagateMean - activation throws for deprecated squash", () => {
  const creature = makeCreature();
  const traceDir = ".test/propagateMean";

  ensureDirSync(traceDir);

  Deno.writeTextFileSync(
    `${traceDir}/0-start.json`,
    JSON.stringify(creature.exportJSON(), null, 1),
  );

  const input = new Float32Array([0.5, 0.3, -0.2]);

  // MEAN is a deprecated squash function not supported by WASM.
  // Activation should throw an error indicating WASM cannot handle it.
  assertThrows(
    () => creature.activate(input),
    Error,
    "WASM activation is not available",
  );
});
