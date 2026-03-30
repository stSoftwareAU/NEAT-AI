/**
 * Issue #1519 - Tests for standalone WASM elastic error distribution.
 *
 * Verifies that the WASM `distribute_elastic_error` function produces
 * results matching the TypeScript `distributeElasticError` implementation,
 * including the weight-based fallback and equal-split last resort.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { ensureWasmActivation } from "../../src/wasm/EnsureWasmActivation.ts";
import {
  distributeElasticError,
  type ElasticLink,
} from "@propagate/ElasticDistribution.ts";
import { wasmDistributeElasticError } from "../../src/wasm/WasmStandaloneFunctions.ts";

await ensureWasmActivation();

/** Tolerance for f32 comparisons. */
const F32_TOLERANCE = 1e-5;

/**
 * Helper: run both TS and WASM implementations and assert they match.
 */
function assertWasmMatchesTs(
  error: number,
  links: ElasticLink[],
  label: string,
  plankConstant = 1e-12,
): void {
  const count = links.length;
  const activations = new Float32Array(count);
  const safeZoneFactors = new Float32Array(count);
  const weights = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    activations[i] = links[i].activation;
    safeZoneFactors[i] = links[i].safeZoneFactor;
    weights[i] = links[i].weight ?? 0;
  }

  const tsResult = distributeElasticError(error, links, { plankConstant });
  const wasmResult = wasmDistributeElasticError(
    error,
    activations,
    safeZoneFactors,
    weights,
    plankConstant,
  );

  if (wasmResult === undefined) {
    throw new Error("WASM module not available");
  }

  assertEquals(
    wasmResult.length,
    tsResult.length,
    `${label}: length mismatch`,
  );

  for (let i = 0; i < count; i++) {
    assertAlmostEquals(
      wasmResult[i],
      tsResult[i],
      F32_TOLERANCE,
      `${label}: share mismatch at index ${i}: wasm=${wasmResult[i]}, ts=${
        tsResult[i]
      }`,
    );
  }
}

Deno.test("wasmDistributeElasticError: prefers higher-activation links", () => {
  assertWasmMatchesTs(10, [
    { activation: 1, safeZoneFactor: 1, weight: 1 },
    { activation: 2, safeZoneFactor: 1, weight: 1 },
  ], "higher-activation");
});

Deno.test("wasmDistributeElasticError: honours safeZoneFactor", () => {
  assertWasmMatchesTs(10, [
    { activation: 1, safeZoneFactor: 1, weight: 1 },
    { activation: 1, safeZoneFactor: 0, weight: 1 },
  ], "safe-zone-blocks");
});

Deno.test("wasmDistributeElasticError: weight-based fallback when activations are zero", () => {
  assertWasmMatchesTs(12, [
    { activation: 0, safeZoneFactor: 1, weight: 1 },
    { activation: 0, safeZoneFactor: 1, weight: 2 },
    { activation: 0, safeZoneFactor: 1, weight: 3 },
  ], "weight-fallback");
});

Deno.test("wasmDistributeElasticError: equal split when both activations and weights are zero", () => {
  assertWasmMatchesTs(9, [
    { activation: 0, safeZoneFactor: 1, weight: 0 },
    { activation: 0, safeZoneFactor: 1, weight: 0 },
    { activation: 0, safeZoneFactor: 1, weight: 0 },
  ], "equal-split");
});

Deno.test("wasmDistributeElasticError: single link gets all error", () => {
  assertWasmMatchesTs(5, [
    { activation: 3, safeZoneFactor: 1, weight: 1 },
  ], "single-link");
});

Deno.test("wasmDistributeElasticError: negative error", () => {
  assertWasmMatchesTs(-6, [
    { activation: 1, safeZoneFactor: 1, weight: 1 },
    { activation: 2, safeZoneFactor: 1, weight: 1 },
  ], "negative-error");
});

Deno.test("wasmDistributeElasticError: zero error returns all zeros", () => {
  assertWasmMatchesTs(0, [
    { activation: 1, safeZoneFactor: 1, weight: 1 },
    { activation: 2, safeZoneFactor: 1, weight: 1 },
  ], "zero-error");
});

Deno.test("wasmDistributeElasticError: empty links", () => {
  assertWasmMatchesTs(10, [], "empty-links");
});

Deno.test("wasmDistributeElasticError: NaN error returns zeros", () => {
  const wasmResult = wasmDistributeElasticError(
    NaN,
    new Float32Array([1, 2]),
    new Float32Array([1, 1]),
    new Float32Array([1, 1]),
    1e-12,
  );
  if (wasmResult === undefined) throw new Error("WASM not available");
  assertEquals(wasmResult.length, 2);
  assertEquals(wasmResult[0], 0);
  assertEquals(wasmResult[1], 0);
});

Deno.test("wasmDistributeElasticError: weight fallback with negative weights uses absolute value", () => {
  assertWasmMatchesTs(10, [
    { activation: 0, safeZoneFactor: 1, weight: -3 },
    { activation: 0, safeZoneFactor: 1, weight: 3 },
  ], "negative-weights");
});

Deno.test("wasmDistributeElasticError: error conservation with many links", () => {
  const count = 100;
  const links: ElasticLink[] = [];
  for (let i = 0; i < count; i++) {
    links.push({
      activation: Math.sin(i * 0.7),
      safeZoneFactor: (Math.cos(i * 0.3) + 1) / 2,
      weight: Math.sin(i * 0.5),
    });
  }
  const error = 42;

  const activations = new Float32Array(links.map((l) => l.activation));
  const safeZoneFactors = new Float32Array(links.map((l) => l.safeZoneFactor));
  const weights = new Float32Array(links.map((l) => l.weight ?? 0));

  const wasmResult = wasmDistributeElasticError(
    error,
    activations,
    safeZoneFactors,
    weights,
    1e-12,
  );
  if (wasmResult === undefined) throw new Error("WASM not available");

  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += wasmResult[i];
  }
  assertAlmostEquals(sum, error, 1e-3, `sum=${sum}, error=${error}`);
});

Deno.test("wasmDistributeElasticError: backward compatibility without weight field", () => {
  // Links without weight field should still work (weight defaults to 0)
  assertWasmMatchesTs(10, [
    { activation: 1, safeZoneFactor: 1 },
    { activation: 2, safeZoneFactor: 1 },
  ], "no-weight-field");
});

Deno.test("wasmDistributeElasticError: activation-based scoring takes priority over weight-based", () => {
  // When activations are non-zero, weights should not affect distribution
  assertWasmMatchesTs(10, [
    { activation: 1, safeZoneFactor: 1, weight: 100 },
    { activation: 2, safeZoneFactor: 1, weight: 0.001 },
  ], "activation-priority");
});
