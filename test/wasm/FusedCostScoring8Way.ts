/**
 * Fused Cost Scoring 8-Way Tests
 *
 * Issue #1209: Tests for WASM fused batch scoring using 8-record SIMD batching.
 * Verifies that 8-record batching produces equivalent results to JS per-record scoring.
 *
 * This test suite specifically exercises the 8-record code path by using
 * datasets with >= 8 records.
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

// Get the project root directory for WASM module path
const projectRoot = new URL("../..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

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

// 16 test records to ensure we exercise the 8-way code path
// (at least one full 8-record batch + remainder handling)
const testRecords = [
  [0.1, 0.2, 0.3, 0.6, 0.4],
  [0.5, 0.5, 0.5, 0.5, 0.5],
  [0.9, 0.1, 0.8, 0.7, 0.3],
  [0.2, 0.8, 0.4, 0.3, 0.8],
  [0.7, 0.3, 0.6, 0.9, 0.2],
  [0.3, 0.6, 0.2, 0.4, 0.7],
  [0.8, 0.2, 0.7, 0.6, 0.5],
  [0.4, 0.7, 0.1, 0.2, 0.9],
  // Second batch of 8 to ensure we test multiple 8-way batches
  [0.6, 0.4, 0.9, 0.8, 0.1],
  [0.1, 0.9, 0.5, 0.4, 0.6],
  [0.8, 0.3, 0.2, 0.5, 0.4],
  [0.2, 0.6, 0.8, 0.7, 0.3],
  [0.9, 0.5, 0.3, 0.1, 0.8],
  [0.3, 0.8, 0.7, 0.6, 0.2],
  [0.5, 0.1, 0.4, 0.3, 0.7],
  [0.7, 0.4, 0.6, 0.9, 0.5],
];

Deno.test("8-Way Fused Cost Scoring: Initialise WASM", async () => {
  await initWasmActivation(wasmPath);
});

Deno.test("8-Way Fused Cost Scoring: MSE - WASM vs JS equivalence", () => {
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

  // WASM fused scoring (should use 8-way path for 16 records)
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
    `MSE 8-way: WASM fused (${wasmSum / testRecords.length}) vs JS (${
      jsSum / testRecords.length
    }) should match`,
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: MAE - WASM vs JS equivalence", () => {
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
    `MAE 8-way: WASM fused (${wasmSum / testRecords.length}) vs JS (${
      jsSum / testRecords.length
    }) should match`,
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: CROSS_ENTROPY - WASM vs JS equivalence", () => {
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
    `CROSS_ENTROPY 8-way: WASM fused (${wasmSum / testRecords.length}) vs JS (${
      jsSum / testRecords.length
    }) should match`,
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: MAPE - WASM vs JS equivalence", () => {
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
    `MAPE 8-way: WASM fused (${wasmSum / testRecords.length}) vs JS (${
      jsSum / testRecords.length
    }) should match`,
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: MSLE - WASM vs JS equivalence", () => {
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
    `MSLE 8-way: WASM fused (${wasmSum / testRecords.length}) vs JS (${
      jsSum / testRecords.length
    }) should match`,
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: HINGE - WASM vs JS equivalence", () => {
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
    `HINGE 8-way: WASM fused (${wasmSum / testRecords.length}) vs JS (${
      jsSum / testRecords.length
    }) should match`,
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: Exact 8 records (boundary condition)", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MSE");

  // Use exactly 8 records
  const eightRecords = testRecords.slice(0, 8);
  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(eightRecords.length * valuesPerRecord);
  for (let i = 0; i < eightRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = eightRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.mseSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of eightRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / eightRecords.length,
    jsSum / eightRecords.length,
    TOLERANCE,
    "MSE 8-way: Exact 8 records boundary should work correctly",
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: 9 records (8 + 1 remainder)", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MSE");

  // Use 9 records to test remainder handling
  const nineRecords = testRecords.slice(0, 9);
  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(nineRecords.length * valuesPerRecord);
  for (let i = 0; i < nineRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = nineRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.mseSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of nineRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / nineRecords.length,
    jsSum / nineRecords.length,
    TOLERANCE,
    "MSE 8-way: 9 records (8 + 1 remainder) should work correctly",
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: 11 records (8 + 3 remainder)", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MSE");

  // Use 11 records to test remainder handling (8 + 3)
  const elevenRecords = testRecords.slice(0, 11);
  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(
    elevenRecords.length * valuesPerRecord,
  );
  for (let i = 0; i < elevenRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = elevenRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.mseSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of elevenRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / elevenRecords.length,
    jsSum / elevenRecords.length,
    TOLERANCE,
    "MSE 8-way: 11 records (8 + 3 remainder) should work correctly",
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: 15 records (8 + 4 + 3 remainder)", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MSE");

  // Use 15 records to test 8-way -> 4-way -> remainder fallback
  const fifteenRecords = testRecords.slice(0, 15);
  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(
    fifteenRecords.length * valuesPerRecord,
  );
  for (let i = 0; i < fifteenRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = fifteenRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.mseSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of fifteenRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / fifteenRecords.length,
    jsSum / fifteenRecords.length,
    TOLERANCE,
    "MSE 8-way: 15 records (8 + 4 + 3 remainder) should work correctly",
  );

  wasmActivation.free();
});

Deno.test("8-Way Fused Cost Scoring: Large dataset (256 records)", () => {
  if (!isWasmActivationAvailable()) return;

  const creature = Creature.fromJSON(testCreatureJSON);
  creature.fix();
  const cost = Costs.find("MSE");

  // Generate 256 records for a larger test
  function seededRandom(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
  }

  const rand = seededRandom(42);
  const largeRecords: number[][] = [];
  for (let i = 0; i < 256; i++) {
    largeRecords.push([
      rand(),
      rand(),
      rand(),
      rand(),
      rand(),
    ]);
  }

  const valuesPerRecord = creature.input + creature.output;
  const packedRecords = new Float32Array(largeRecords.length * valuesPerRecord);
  for (let i = 0; i < largeRecords.length; i++) {
    for (let j = 0; j < valuesPerRecord; j++) {
      packedRecords[i * valuesPerRecord + j] = largeRecords[i][j];
    }
  }

  const compiledData = compileCreatureToWasm(creature);
  const wasmActivation = WasmCreatureActivation.create(compiledData);
  assert(wasmActivation !== null, "WASM activation should be created");

  const wasmSum = wasmActivation.mseSumBatchPacked(
    packedRecords,
    creature.input,
    true,
  );

  let jsSum = 0;
  for (const record of largeRecords) {
    const inputs = new Float32Array(record.slice(0, creature.input));
    const targets = new Float32Array(record.slice(creature.input));
    const outputs = creature.activate(inputs, false);
    jsSum += cost.calculate(targets, outputs);
  }

  assertAlmostEquals(
    wasmSum / largeRecords.length,
    jsSum / largeRecords.length,
    TOLERANCE,
    "MSE 8-way: 256 records should work correctly",
  );

  wasmActivation.free();
});
