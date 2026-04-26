import { assertAlmostEquals } from "@std/assert";
import { distributeElasticError } from "@propagate/ElasticDistribution.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";

// Issue #2416 — distributeElasticError now delegates to WASM. Ensure the
// module is loaded before any test runs.
await ensureWasmActivation();

// Issue #2416 — the WASM implementation operates in f32, so loosen the
// tolerance from the historical f64 value used by the TS implementation.
const F32_TOLERANCE = 1e-5;

Deno.test("distributeElasticError: weight-based fallback prefers larger weights when activations are zero", () => {
  const error = 10;
  // All activations zero, safe zones zero => fallback path
  // But with weights provided, should use weight² scoring instead of equal split
  const shares = distributeElasticError(error, [
    { activation: 0, safeZoneFactor: 0, weight: 1 },
    { activation: 0, safeZoneFactor: 0, weight: 3 },
  ]);

  // With weight-based fallback, scores are 1² and 3² = 1 and 9
  // So shares should be 10 * 1/10 = 1 and 10 * 9/10 = 9
  assertAlmostEquals(shares[0], 1, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 9, F32_TOLERANCE);
  assertAlmostEquals(shares[0] + shares[1], error, F32_TOLERANCE);
});

Deno.test("distributeElasticError: weight-based fallback with equal weights gives equal split", () => {
  const error = 12;
  const shares = distributeElasticError(error, [
    { activation: 0, safeZoneFactor: 0, weight: 2 },
    { activation: 0, safeZoneFactor: 0, weight: 2 },
    { activation: 0, safeZoneFactor: 0, weight: 2 },
  ]);

  // Equal weights => equal shares
  assertAlmostEquals(shares[0], 4, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 4, F32_TOLERANCE);
  assertAlmostEquals(shares[2], 4, F32_TOLERANCE);
});

Deno.test("distributeElasticError: weight-based fallback uses absolute weight", () => {
  const error = 10;
  // Negative weights should contribute same as positive (weight² is always positive)
  const shares = distributeElasticError(error, [
    { activation: 0, safeZoneFactor: 0, weight: -3 },
    { activation: 0, safeZoneFactor: 0, weight: 1 },
  ]);

  // Scores: (-3)²=9 and 1²=1 => shares 9 and 1
  assertAlmostEquals(shares[0], 9, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 1, F32_TOLERANCE);
});

Deno.test("distributeElasticError: falls back to equal split only when both activations and weights are zero", () => {
  const error = 10;
  // No weights provided (undefined) and activations are zero => true equal split
  const shares = distributeElasticError(error, [
    { activation: 0, safeZoneFactor: 0 },
    { activation: 0, safeZoneFactor: 0 },
  ]);

  // Should still equal-split when no weight info available
  assertAlmostEquals(shares[0], 5, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 5, F32_TOLERANCE);
});

Deno.test("distributeElasticError: activation-based scoring takes priority over weight-based", () => {
  const error = 10;
  // When activations are non-zero, activation² * safeZone should still be used
  const shares = distributeElasticError(error, [
    { activation: 1, safeZoneFactor: 1, weight: 10 },
    { activation: 2, safeZoneFactor: 1, weight: 1 },
  ]);

  // Activation-based scores: 1²=1 and 2²=4
  // Shares: 2 and 8 (weights are irrelevant since activations are available)
  assertAlmostEquals(shares[0], 2, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 8, F32_TOLERANCE);
});

Deno.test("distributeElasticError: weight-based fallback with all zero weights falls back to equal split", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 0, safeZoneFactor: 0, weight: 0 },
    { activation: 0, safeZoneFactor: 0, weight: 0 },
  ]);

  // All weights zero => true equal split (last resort)
  assertAlmostEquals(shares[0], 5, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 5, F32_TOLERANCE);
});

Deno.test("distributeElasticError: preserves backward compatibility without weight field", () => {
  // Existing tests should still pass - links without weight field
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1, safeZoneFactor: 1 },
    { activation: 2, safeZoneFactor: 1 },
  ]);

  assertAlmostEquals(shares[0], 2, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 8, F32_TOLERANCE);
});

Deno.test("distributeElasticError: weight fallback with tiny activations below plankConstant", () => {
  const error = 6;
  // Activations are tiny (below plankConstant) but safe zones are 1
  // In this case activation² * safeZone will be tiny, triggering fallback
  const shares = distributeElasticError(error, [
    { activation: 1e-15, safeZoneFactor: 1, weight: 1 },
    { activation: 1e-15, safeZoneFactor: 1, weight: 2 },
  ], { plankConstant: 1e-12 });

  // Activation scores are ~1e-30 (below plankConstant), so weight fallback kicks in
  // Weight scores: 1²=1, 2²=4 => shares 6/5*1=1.2 and 6/5*4=4.8
  assertAlmostEquals(shares[0], 1.2, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 4.8, F32_TOLERANCE);
});
