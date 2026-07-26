/**
 * Issue #3477 — tests for the typed-array-native elastic distribution entry
 * point `distributeElasticErrorTyped`.
 *
 * The typed entry point feeds already-populated `Float32Array` activation and
 * weight buffers plus a uniform scalar `safeZoneFactor` straight into the WASM
 * `distribute_elastic_error` function, bypassing the per-link `ElasticLink[]`
 * object allocation used by `distributeElasticError`. For a uniform
 * `safeZoneFactor` the two entry points must produce identical shares because
 * both feed the same underlying WASM ABI.
 *
 * Australian English: behaviour, normalise.
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  distributeElasticError,
  distributeElasticErrorTyped,
} from "@propagate/ElasticDistribution.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";

await ensureWasmActivation();

// The WASM implementation operates in f32, so both entry points already agree
// to f32 precision. Keep a tight tolerance to catch any real divergence.
const F32_TOLERANCE = 1e-6;

function assertSharesEqual(
  typed: Float32Array,
  object: number[],
  message: string,
) {
  assertEquals(typed.length, object.length, `${message}: length`);
  for (let i = 0; i < object.length; i++) {
    assertAlmostEquals(
      typed[i],
      object[i],
      F32_TOLERANCE,
      `${message}: [${i}]`,
    );
  }
}

Deno.test("distributeElasticErrorTyped: matches object API with non-zero activations", () => {
  const error = 5;
  const activations = new Float32Array([0.2, -0.4, 0.9]);
  const weights = new Float32Array([0.3, 0.7, -0.1]);

  const typed = distributeElasticErrorTyped(error, activations, weights, 1);
  const object = distributeElasticError(error, [
    { activation: 0.2, safeZoneFactor: 1, weight: 0.3 },
    { activation: -0.4, safeZoneFactor: 1, weight: 0.7 },
    { activation: 0.9, safeZoneFactor: 1, weight: -0.1 },
  ]);

  assertSharesEqual(typed, object, "non-zero activations");
  // Shares reconstruct the full error.
  let sum = 0;
  for (const s of typed) sum += s;
  assertAlmostEquals(sum, error, 1e-4, "shares sum to error");
});

Deno.test("distributeElasticErrorTyped: weight-based fallback when activations are zero", () => {
  // All activations zero exercises the weight² fallback inside WASM.
  const error = 10;
  const activations = new Float32Array([0, 0]);
  const weights = new Float32Array([1, 3]);

  const typed = distributeElasticErrorTyped(error, activations, weights, 1);

  // Scores are 1² and 3² = 1 and 9 → shares 1 and 9.
  assertAlmostEquals(typed[0], 1, 1e-4, "small weight share");
  assertAlmostEquals(typed[1], 9, 1e-4, "large weight share");
});

Deno.test("distributeElasticErrorTyped: honours the plankConstant option", () => {
  const error = 3;
  const activations = new Float32Array([0.5, 0.5]);
  const weights = new Float32Array([0.5, 0.5]);

  const typed = distributeElasticErrorTyped(
    error,
    activations,
    weights,
    1,
    { plankConstant: 1e-7 },
  );
  const object = distributeElasticError(
    error,
    [
      { activation: 0.5, safeZoneFactor: 1, weight: 0.5 },
      { activation: 0.5, safeZoneFactor: 1, weight: 0.5 },
    ],
    { plankConstant: 1e-7 },
  );

  assertSharesEqual(typed, object, "plankConstant option");
});

Deno.test("distributeElasticErrorTyped: subarray views are handled by length", () => {
  // The caller passes over-sized pooled buffers via subarray(0, count); ensure
  // the function respects the view length, not the backing buffer length.
  const error = 5;
  const backingActivations = new Float32Array([0.2, -0.4, 0.9, 99, 99]);
  const backingWeights = new Float32Array([0.3, 0.7, -0.1, 99, 99]);
  const count = 3;

  const typed = distributeElasticErrorTyped(
    error,
    backingActivations.subarray(0, count),
    backingWeights.subarray(0, count),
    1,
  );
  const object = distributeElasticError(error, [
    { activation: 0.2, safeZoneFactor: 1, weight: 0.3 },
    { activation: -0.4, safeZoneFactor: 1, weight: 0.7 },
    { activation: 0.9, safeZoneFactor: 1, weight: -0.1 },
  ]);

  assertSharesEqual(typed, object, "subarray view");
});

Deno.test("distributeElasticErrorTyped: empty input returns empty result", () => {
  const typed = distributeElasticErrorTyped(
    5,
    new Float32Array(0),
    new Float32Array(0),
    1,
  );
  assertEquals(typed.length, 0);
});
