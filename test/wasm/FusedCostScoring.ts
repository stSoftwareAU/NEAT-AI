/**
 * Fused Cost Scoring Tests
 *
 * Tests for WASM fused batch scoring functions for all cost types.
 * Verifies that fused WASM scoring produces equivalent results to
 * JS per-record scoring.
 */

import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  WasmCreatureActivation,
} from "../../src/wasm/mod.ts";
import { compileCreatureToWasm } from "../../src/wasm/CompileToWasm.ts";
import { Costs } from "../../src/Costs.ts";

// Tolerance for f32 vs f64 precision differences
const TOLERANCE = 1e-4;

// Test creature configuration (input neurons are implicit via `input` count)
// 3 inputs, 2 hidden, 2 outputs
const testCreatureJSON: CreatureInternal = {
  neurons: [
    // Hidden neurons (indices 3, 4 after 3 implicit inputs 0, 1, 2)
    { type: "hidden", index: 3, bias: 0.1, squash: "TANH" },
    { type: "hidden", index: 4, bias: -0.2, squash: "LOGISTIC" },
    // Output neurons (indices 5, 6)
    { type: "output", index: 5, bias: 0.05, squash: "LOGISTIC" },
    { type: "output", index: 6, bias: -0.1, squash: "LOGISTIC" },
  ],
  synapses: [
    { from: 0, to: 3, weight: 0.5 },
    { from: 1, to: 3, weight: -0.3 },
    { from: 2, to: 4, weight: 0.4 },
    { from: 3, to: 5, weight: 0.7 },
    { from: 4, to: 5, weight: -0.2 },
    { from: 3, to: 6, weight: 0.3 },
    { from: 4, to: 6, weight: 0.8 },
  ],
  input: 3,
  output: 2,
};

// Test records: [input0, input1, input2, target0, target1]
const testRecords = [
  [0.1, 0.2, 0.3, 0.6, 0.4],
  [0.5, 0.5, 0.5, 0.5, 0.5],
  [0.9, 0.1, 0.8, 0.7, 0.3],
  [0.2, 0.8, 0.4, 0.3, 0.8],
  [0.7, 0.3, 0.6, 0.9, 0.2],
];

Deno.test("Fused Cost Scoring: Initialise WASM", async () => {
  await initWasmActivation();
});

Deno.test("Fused Cost Scoring: MSE - WASM vs JS equivalence", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MSE");

  // Pack records into Float32Array
  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(testRecords.length * valuesPerRecord);
  for (let i = 0; i < testRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = testRecords[i][j];
    }
  }

  // Compile to WASM
  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  // WASM fused scoring
  const wasmSum = wasmActivation.mseSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  // JS per-record scoring
  let jsSum = 0;
  for (const record of testRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / testRecords.length,
    jsSum / testRecords.length,
    TOLERANCE,
    "MSE: WASM fused vs JS should match",
  );

  wasmActivation.free();
});

Deno.test("Fused Cost Scoring: MAE - WASM vs JS equivalence", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MAE");

  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(testRecords.length * valuesPerRecord);
  for (let i = 0; i < testRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = testRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.maeSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of testRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / testRecords.length,
    jsSum / testRecords.length,
    TOLERANCE,
    "MAE: WASM fused vs JS should match",
  );

  wasmActivation.free();
});

Deno.test("Fused Cost Scoring: CROSS_ENTROPY - WASM vs JS equivalence", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("CROSS_ENTROPY");

  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(testRecords.length * valuesPerRecord);
  for (let i = 0; i < testRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = testRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.crossEntropySumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of testRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / testRecords.length,
    jsSum / testRecords.length,
    TOLERANCE,
    "CROSS_ENTROPY: WASM fused vs JS should match",
  );

  wasmActivation.free();
});

Deno.test("Fused Cost Scoring: MAPE - WASM vs JS equivalence", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MAPE");

  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(testRecords.length * valuesPerRecord);
  for (let i = 0; i < testRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = testRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.mapeSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of testRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / testRecords.length,
    jsSum / testRecords.length,
    TOLERANCE,
    "MAPE: WASM fused vs JS should match",
  );

  wasmActivation.free();
});

Deno.test("Fused Cost Scoring: MSLE - WASM vs JS equivalence", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MSLE");

  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(testRecords.length * valuesPerRecord);
  for (let i = 0; i < testRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = testRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.msleSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of testRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  // MSLE doesn't average per output, so compare sums directly
  assertAlmostEquals(
    wasmSum / testRecords.length,
    jsSum / testRecords.length,
    TOLERANCE,
    "MSLE: WASM fused vs JS should match",
  );

  wasmActivation.free();
});

Deno.test("Fused Cost Scoring: HINGE - WASM vs JS equivalence", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("HINGE");

  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(testRecords.length * valuesPerRecord);
  for (let i = 0; i < testRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = testRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.hingeSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of testRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  // HINGE doesn't average per output, so compare sums directly
  assertAlmostEquals(
    wasmSum / testRecords.length,
    jsSum / testRecords.length,
    TOLERANCE,
    "HINGE: WASM fused vs JS should match",
  );

  wasmActivation.free();
});

Deno.test("Fused Cost Scoring: Empty records returns zero", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const emptyRecords = new Float32Array(0);

  assertAlmostEquals(
    wasmActivation.mseSumBatchPacked(emptyRecords, creature.input, true),
    0,
    0,
    "MSE with empty records should return 0",
  );
  assertAlmostEquals(
    wasmActivation.maeSumBatchPacked(emptyRecords, creature.input, true),
    0,
    0,
    "MAE with empty records should return 0",
  );
  assertAlmostEquals(
    wasmActivation.crossEntropySumBatchPacked(
      emptyRecords,
      creature.input,
      true,
    ),
    0,
    0,
    "CROSS_ENTROPY with empty records should return 0",
  );
  assertAlmostEquals(
    wasmActivation.mapeSumBatchPacked(emptyRecords, creature.input, true),
    0,
    0,
    "MAPE with empty records should return 0",
  );
  assertAlmostEquals(
    wasmActivation.msleSumBatchPacked(emptyRecords, creature.input, true),
    0,
    0,
    "MSLE with empty records should return 0",
  );
  assertAlmostEquals(
    wasmActivation.hingeSumBatchPacked(emptyRecords, creature.input, true),
    0,
    0,
    "HINGE with empty records should return 0",
  );

  wasmActivation.free();
});
