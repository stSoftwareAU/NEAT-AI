/**
 * Issue #1377 - Tests for fused backward pass error distribution WASM function.
 *
 * The fused function combines calculateError + safeZoneAdjustment + elastic
 * distribution into a single WASM call. These tests verify that the fused
 * results match the separate TS/WASM approach within f32 tolerance.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { ensureWasmActivation } from "../../src/wasm/EnsureWasmActivation.ts";
import {
  getSquashType,
  wasmCalculateError,
  wasmSafeZoneAdjustmentBatch,
} from "../../src/wasm/mod.ts";
import { distributeElasticError } from "../../src/propagate/ElasticDistribution.ts";
import { wasmFusedErrorDistribution } from "../../src/wasm/WasmActivation.ts";

await ensureWasmActivation();

/** Tolerance for f32 comparisons */
const F32_TOLERANCE = 1e-5;

/**
 * Helper: compute the expected result using the separate (current) approach.
 */
function computeSeparateResult(
  neuronSquashType: number,
  neuronActivation: number,
  neuronTargetActivation: number,
  neuronHintValue: number,
  upstreamSquashTypes: Uint8Array,
  upstreamHintValues: Float32Array,
  upstreamActivations: Float32Array,
  synapseWeights: Float32Array,
): { error: number; perLinkError: number[] } {
  const count = upstreamSquashTypes.length;

  // Step 1: calculateError
  const error = wasmCalculateError(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
  );

  // Step 2: safeZoneAdjustment
  const provisionalErrorPerLink = error / count;
  const safeZoneFactors = wasmSafeZoneAdjustmentBatch(
    upstreamSquashTypes,
    upstreamHintValues,
    provisionalErrorPerLink,
    synapseWeights,
  );

  // Step 3: distributeElasticError
  const linkMeta = new Array(count);
  for (let i = 0; i < count; i++) {
    linkMeta[i] = {
      activation: upstreamActivations[i],
      safeZoneFactor: safeZoneFactors[i],
    };
  }
  const perLinkError = distributeElasticError(error, linkMeta);

  return { error, perLinkError };
}

Deno.test("fusedErrorDistribution: matches separate approach for ReLU neuron with mixed upstream squashes", () => {
  const neuronSquashType = getSquashType("ReLU");
  const neuronActivation = 0.5;
  const neuronTargetActivation = 0.8;
  const neuronHintValue = 0.5;

  const upstreamSquashTypes = new Uint8Array([
    getSquashType("TANH"),
    getSquashType("LOGISTIC"),
    getSquashType("IDENTITY"),
    getSquashType("ReLU"),
  ]);
  const upstreamHintValues = new Float32Array([0.5, -1.0, 2.0, 0.3]);
  const upstreamActivations = new Float32Array([0.46, 0.27, 2.0, 0.3]);
  const synapseWeights = new Float32Array([0.5, 1.0, -0.3, 0.8]);

  const expected = computeSeparateResult(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  const fusedResult = wasmFusedErrorDistribution(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  assertEquals(fusedResult.perLinkError.length, 4);
  assertAlmostEquals(fusedResult.error, expected.error, F32_TOLERANCE);
  for (let i = 0; i < 4; i++) {
    assertAlmostEquals(
      fusedResult.perLinkError[i],
      expected.perLinkError[i],
      F32_TOLERANCE,
      `perLinkError mismatch at index ${i}: fused=${
        fusedResult.perLinkError[i]
      }, expected=${expected.perLinkError[i]}`,
    );
  }
});

Deno.test("fusedErrorDistribution: single synapse matches separate approach", () => {
  const neuronSquashType = getSquashType("TANH");
  const neuronActivation = 0.0;
  const neuronTargetActivation = 0.5;
  const neuronHintValue = 0.0;

  const upstreamSquashTypes = new Uint8Array([getSquashType("IDENTITY")]);
  const upstreamHintValues = new Float32Array([1.0]);
  const upstreamActivations = new Float32Array([1.0]);
  const synapseWeights = new Float32Array([1.0]);

  const expected = computeSeparateResult(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  const fusedResult = wasmFusedErrorDistribution(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  assertEquals(fusedResult.perLinkError.length, 1);
  assertAlmostEquals(fusedResult.error, expected.error, F32_TOLERANCE);
  assertAlmostEquals(
    fusedResult.perLinkError[0],
    expected.perLinkError[0],
    F32_TOLERANCE,
  );
});

Deno.test("fusedErrorDistribution: handles zero error (target equals current)", () => {
  const neuronSquashType = getSquashType("LOGISTIC");
  const neuronActivation = 0.5;
  const neuronTargetActivation = 0.5;
  const neuronHintValue = 0.0;

  const upstreamSquashTypes = new Uint8Array([
    getSquashType("ReLU"),
    getSquashType("TANH"),
  ]);
  const upstreamHintValues = new Float32Array([1.0, -0.5]);
  const upstreamActivations = new Float32Array([1.0, -0.46]);
  const synapseWeights = new Float32Array([0.5, 0.3]);

  const fusedResult = wasmFusedErrorDistribution(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  assertEquals(fusedResult.perLinkError.length, 2);
  // Error should be zero or very near zero
  assertAlmostEquals(fusedResult.error, 0, F32_TOLERANCE);
  assertAlmostEquals(fusedResult.perLinkError[0], 0, F32_TOLERANCE);
  assertAlmostEquals(fusedResult.perLinkError[1], 0, F32_TOLERANCE);
});

Deno.test("fusedErrorDistribution: all saturated links fall back to equal split", () => {
  // Use TANH with very large inputs (deeply saturated)
  const neuronSquashType = getSquashType("IDENTITY");
  const neuronActivation = 1.0;
  const neuronTargetActivation = 2.0;
  const neuronHintValue = 1.0;

  // All upstream neurons are deeply saturated TANH (hintValue = ±100)
  const upstreamSquashTypes = new Uint8Array([
    getSquashType("TANH"),
    getSquashType("TANH"),
    getSquashType("TANH"),
  ]);
  const upstreamHintValues = new Float32Array([100.0, -100.0, 100.0]);
  const upstreamActivations = new Float32Array([1.0, -1.0, 1.0]);
  const synapseWeights = new Float32Array([1.0, 1.0, 1.0]);

  const expected = computeSeparateResult(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  const fusedResult = wasmFusedErrorDistribution(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  assertEquals(fusedResult.perLinkError.length, 3);
  assertAlmostEquals(fusedResult.error, expected.error, F32_TOLERANCE);
  for (let i = 0; i < 3; i++) {
    assertAlmostEquals(
      fusedResult.perLinkError[i],
      expected.perLinkError[i],
      F32_TOLERANCE,
      `perLinkError mismatch at index ${i}`,
    );
  }
});

Deno.test("fusedErrorDistribution: large synapse count matches separate approach", () => {
  const neuronSquashType = getSquashType("GELU");
  const neuronActivation = 0.3;
  const neuronTargetActivation = 0.7;
  const neuronHintValue = 0.2;

  const count = 100;
  const squashNames = [
    "ReLU",
    "TANH",
    "LOGISTIC",
    "IDENTITY",
    "GELU",
    "LeakyReLU",
  ];
  const squashTypeValues = squashNames.map((n) => getSquashType(n));

  // Seeded random for reproducibility
  let seed = 12345;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };

  const upstreamSquashTypes = new Uint8Array(count);
  const upstreamHintValues = new Float32Array(count);
  const upstreamActivations = new Float32Array(count);
  const synapseWeights = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    upstreamSquashTypes[i] = squashTypeValues[
      Math.floor(Math.abs(nextRandom()) * squashTypeValues.length)
    ];
    upstreamHintValues[i] = nextRandom() * 5;
    upstreamActivations[i] = nextRandom();
    synapseWeights[i] = nextRandom() * 2;
  }

  const expected = computeSeparateResult(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  const fusedResult = wasmFusedErrorDistribution(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  assertEquals(fusedResult.perLinkError.length, count);
  assertAlmostEquals(fusedResult.error, expected.error, F32_TOLERANCE);

  for (let i = 0; i < count; i++) {
    assertAlmostEquals(
      fusedResult.perLinkError[i],
      expected.perLinkError[i],
      F32_TOLERANCE,
      `perLinkError mismatch at index ${i}: fused=${
        fusedResult.perLinkError[i]
      }, expected=${expected.perLinkError[i]}`,
    );
  }
});

Deno.test("fusedErrorDistribution: negative error distributes correctly", () => {
  const neuronSquashType = getSquashType("IDENTITY");
  const neuronActivation = 2.0;
  const neuronTargetActivation = 1.0;
  const neuronHintValue = 2.0;

  const upstreamSquashTypes = new Uint8Array([
    getSquashType("IDENTITY"),
    getSquashType("IDENTITY"),
  ]);
  const upstreamHintValues = new Float32Array([1.0, 2.0]);
  const upstreamActivations = new Float32Array([1.0, 2.0]);
  const synapseWeights = new Float32Array([1.0, 1.0]);

  const expected = computeSeparateResult(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  const fusedResult = wasmFusedErrorDistribution(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  assertEquals(fusedResult.perLinkError.length, 2);
  assertAlmostEquals(fusedResult.error, expected.error, F32_TOLERANCE);
  for (let i = 0; i < 2; i++) {
    assertAlmostEquals(
      fusedResult.perLinkError[i],
      expected.perLinkError[i],
      F32_TOLERANCE,
    );
  }
});

Deno.test("fusedErrorDistribution: safeZoneFactors returned match batch call", () => {
  const neuronSquashType = getSquashType("LOGISTIC");
  const neuronActivation = 0.7;
  const neuronTargetActivation = 0.3;
  const neuronHintValue = 0.85;

  const upstreamSquashTypes = new Uint8Array([
    getSquashType("TANH"),
    getSquashType("ReLU"),
    getSquashType("LeakyReLU"),
  ]);
  const upstreamHintValues = new Float32Array([0.5, 2.0, -0.5]);
  const upstreamActivations = new Float32Array([0.46, 2.0, -0.005]);
  const synapseWeights = new Float32Array([1.0, 0.5, -1.0]);

  // Get expected safe zone factors from batch call
  const error = wasmCalculateError(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
  );
  const expectedSafeZones = wasmSafeZoneAdjustmentBatch(
    upstreamSquashTypes,
    upstreamHintValues,
    error / 3,
    synapseWeights,
  );

  const fusedResult = wasmFusedErrorDistribution(
    neuronSquashType,
    neuronActivation,
    neuronTargetActivation,
    neuronHintValue,
    upstreamSquashTypes,
    upstreamHintValues,
    upstreamActivations,
    synapseWeights,
  );

  assertEquals(fusedResult.safeZoneFactors.length, 3);
  for (let i = 0; i < 3; i++) {
    assertAlmostEquals(
      fusedResult.safeZoneFactors[i],
      expectedSafeZones[i],
      F32_TOLERANCE,
      `safeZoneFactor mismatch at index ${i}`,
    );
  }
});
