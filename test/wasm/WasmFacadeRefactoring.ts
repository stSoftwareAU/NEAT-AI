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
  assertThrows,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  type FusedErrorDistributionResult,
  initWasmActivation,
  isWasmActivationAvailable,
  SquashType,
  type WasmActivationRange,
  wasmCalculateError,
  WasmCreatureActivation,
  wasmDerivative,
  wasmFusedErrorDistribution,
  wasmGetRange,
  wasmLimitRange,
  wasmSafeZoneAdjustment,
  wasmSafeZoneAdjustmentBatch,
  wasmSquash,
  type WasmTraceEntry,
  type WasmTraceResult,
  wasmUnSquash,
  wasmValidateRange,
  wasmVersion,
} from "../../src/wasm/mod.ts";

// Ensure WASM is loaded
await initWasmActivation();

// ---------------------------------------------------------------------------
// Module availability
// ---------------------------------------------------------------------------

Deno.test("isWasmActivationAvailable returns true after init", () => {
  assert(isWasmActivationAvailable());
});

Deno.test("wasmVersion returns a version string", () => {
  const version = wasmVersion();
  assert(version !== "not loaded", "Expected a version string");
  assert(version.length > 0, "Version should not be empty");
});

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
  for (let i = 0; i < result.length; i++) {
    assert(
      result[i] >= 0 && result[i] <= 1,
      `Factor ${i} out of range: ${result[i]}`,
    );
  }
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
  assertExists(result.error);
  assertEquals(result.safeZoneFactors.length, 1);
  assertEquals(result.perLinkError.length, 1);
});

Deno.test("wasmGetRange returns valid range for Logistic", () => {
  const range: WasmActivationRange = wasmGetRange(SquashType.Logistic);
  assertAlmostEquals(range.low, 0, 1e-5);
  assertAlmostEquals(range.high, 1, 1e-5);
});

Deno.test("wasmValidateRange accepts valid Logistic value", () => {
  assert(wasmValidateRange(SquashType.Logistic, 0.5));
});

Deno.test("wasmLimitRange clamps out-of-range value", () => {
  const clamped = wasmLimitRange(SquashType.Logistic, 1.5);
  assert(clamped <= 1.0, `Expected clamped <= 1.0 but got ${clamped}`);
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

Deno.test("WasmCreatureActivation.activate throws after free", () => {
  const creature = new Creature(2, 1);
  const activation = WasmCreatureActivation.fromCreature(creature);
  assertExists(activation);

  activation.free();
  assertThrows(
    () => activation.activate(new Float32Array([0.5, 0.3])),
    Error,
    "has been freed",
  );
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

  // WasmTraceEntry type check (structural)
  for (const entry of result.traceEntries) {
    const _te: WasmTraceEntry = entry;
    assertExists(_te.neuronRelativeIndex);
    assertExists(_te.traceInfo);
  }

  activation.free();
});

Deno.test("WasmCreatureActivation activateWithState works", () => {
  const creature = new Creature(2, 1);
  const activation = WasmCreatureActivation.fromCreature(creature);
  assertExists(activation);

  const input = new Float32Array([0.5, 0.3]);
  const output = activation.activateWithState(input, false);
  assertEquals(output.length, 1);
  activation.free();
});
