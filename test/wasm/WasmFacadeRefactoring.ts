/**
 * Issue #1405 - Tests for WASM facade refactoring.
 *
 * Verifies that the refactored module structure (WasmModuleLoader,
 * WasmStandaloneFunctions, WasmAutoInit, WasmActivation) preserves the
 * same public API surface and behaviour as the original monolithic
 * WasmActivation.ts.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertExists,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  type FusedErrorDistributionResult,
  initWasmActivation,
  SquashType,
  type WasmActivationRange,
  wasmCalculateError,
  WasmCreatureActivation,
  wasmDerivative,
  wasmFusedErrorDistribution,
  wasmGetRange,
  wasmSafeZoneAdjustment,
  wasmSafeZoneAdjustmentBatch,
  wasmSquash,
  type WasmTraceEntry,
  type WasmTraceResult,
  wasmUnSquash,
} from "../../src/wasm/mod.ts";

// Ensure WASM is loaded
await initWasmActivation();

// ---------------------------------------------------------------------------
// Standalone functions via WasmStandaloneFunctions
// ---------------------------------------------------------------------------

Deno.test("wasmSquash delegates correctly for ReLU", () => {
  assertEquals(wasmSquash(SquashType.Relu, -1), 0);
  assertEquals(wasmSquash(SquashType.Relu, 5), 5);
});

Deno.test("wasmSquash delegates correctly for Logistic", () => {
  assertAlmostEquals(wasmSquash(SquashType.Logistic, 0), 0.5, 1e-5);
});

Deno.test("wasmDerivative returns correct value for Tanh", () => {
  const d = wasmDerivative(SquashType.Tanh, 0);
  assertAlmostEquals(d, 1.0, 1e-5);
});

Deno.test("wasmUnSquash round-trips with squash for Logistic", () => {
  const squashed = wasmSquash(SquashType.Logistic, 0.5);
  const unsquashed = wasmUnSquash(SquashType.Logistic, squashed, 0.5);
  assertAlmostEquals(unsquashed, 0.5, 1e-3);
});

Deno.test("wasmSafeZoneAdjustment returns 1 for LOGISTIC within safe zone", () => {
  // rawInput=0.5 is well inside LOGISTIC's safe zone [-6, 6], factor should be 1
  const result = wasmSafeZoneAdjustment(SquashType.Logistic, 0.5, 0.1);
  assertAlmostEquals(result, 1.0, 1e-5);
});

Deno.test("wasmSafeZoneAdjustmentBatch processes multiple synapses", () => {
  const squashTypes = new Uint8Array([SquashType.Relu, SquashType.Logistic]);
  const rawInputs = new Float32Array([0.5, 0.3]);
  const weights = new Float32Array([1.0, 0.5]);
  const result = wasmSafeZoneAdjustmentBatch(
    squashTypes,
    rawInputs,
    0.1,
    weights,
  );
  assertEquals(result.length, 2);
  // ReLU with positive input 0.5 should have full confidence (factor = 1)
  assertEquals(result[0], 1, "ReLU factor for positive input should be 1");
  // LOGISTIC with input 0.3 inside safe zone [-6, 6] should also be 1
  assertEquals(result[1], 1, "LOGISTIC factor inside safe zone should be 1");
});

Deno.test("wasmCalculateError returns positive error for LOGISTIC when target exceeds current", () => {
  const error = wasmCalculateError(SquashType.Logistic, 0.5, 0.8, 0.0);
  assert(isFinite(error), `Expected finite error but got ${error}`);
  assert(
    error > 0,
    `Expected positive error when target (0.8) > current (0.0), got ${error}`,
  );
});

Deno.test("wasmFusedErrorDistribution returns expected structure", () => {
  const result: FusedErrorDistributionResult = wasmFusedErrorDistribution(
    SquashType.Logistic,
    0.5,
    0.8,
    0.0,
    new Uint8Array([SquashType.Relu]),
    new Float32Array([0.3]),
    new Float32Array([0.3]),
    new Float32Array([1.0]),
  );
  assert(
    Number.isFinite(result.error),
    `Expected finite error, got ${result.error}`,
  );
  assertEquals(result.safeZoneFactors.length, 1);
  assertEquals(result.perLinkError.length, 1);
  assert(
    result.safeZoneFactors[0] >= 0 && result.safeZoneFactors[0] <= 1,
    `safeZoneFactors[0] should be in [0, 1], got ${result.safeZoneFactors[0]}`,
  );
});

Deno.test("wasmGetRange returns valid range for Logistic", () => {
  const range: WasmActivationRange = wasmGetRange(SquashType.Logistic);
  assertAlmostEquals(range.low, 0, 1e-5);
  assertAlmostEquals(range.high, 1, 1e-5);
});

// ---------------------------------------------------------------------------
// WasmCreatureActivation class
// ---------------------------------------------------------------------------

Deno.test("WasmCreatureActivation.fromCreature produces valid activation", () => {
  const creature = new Creature(2, 1);
  const activation = WasmCreatureActivation.fromCreature(creature);
  assertExists(activation);

  const input = new Float32Array([0.5, 0.3]);
  const output = activation.activate(input);
  assertEquals(output.length, 1);
  activation.free();
});

Deno.test("WasmCreatureActivation trace types are accessible", () => {
  const creature = new Creature(2, 1);
  const activation = WasmCreatureActivation.fromCreature(creature);
  assertExists(activation);

  const input = new Float32Array([0.5, 0.3]);
  const result: WasmTraceResult = activation.activateAndTrace(input);
  assertEquals(result.outputs.length, 1);
  assertExists(result.activations);
  assertExists(result.hintValues);

  // Verify trace entries contain valid numeric data when present
  for (const entry of result.traceEntries) {
    const te: WasmTraceEntry = entry;
    assert(
      Number.isInteger(te.neuronRelativeIndex) && te.neuronRelativeIndex >= 0,
      `neuronRelativeIndex should be a non-negative integer, got ${te.neuronRelativeIndex}`,
    );
    assert(
      Number.isFinite(te.traceInfo),
      `traceInfo should be finite, got ${te.traceInfo}`,
    );
  }

  activation.free();
});

Deno.test("WasmCreatureActivation activateWithState returns output of correct length", () => {
  const creature = new Creature(2, 1);
  const activation = WasmCreatureActivation.fromCreature(creature);
  assertExists(activation);

  const input = new Float32Array([0.5, 0.3]);
  const output = activation.activateWithState(input, false);
  assertEquals(output.length, 1);
  assert(
    Number.isFinite(output[0]),
    `Expected finite output value, got ${output[0]}`,
  );
  activation.free();
});
