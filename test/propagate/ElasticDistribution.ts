/**
 * Consolidated tests for ElasticDistribution — verifying error conservation,
 * proportional distribution, safe-zone effects, fallback behaviour, and
 * edge cases.
 *
 * Merged from ElasticDistribution.ts and ElasticDistributionBehaviour.ts
 * as part of Issue #1766 (propagation module test audit).
 */
import { assertAlmostEquals, assertEquals, assertGreater } from "@std/assert";
import {
  distributeElasticError,
  type ElasticLink,
} from "@propagate/ElasticDistribution.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";

// Issue #2416 — distributeElasticError now delegates to WASM. Ensure the
// module is loaded before any test runs.
await ensureWasmActivation();

// Issue #2416 — the WASM implementation operates in f32, so loosen the
// tolerance from the historical f64 value used by the TS implementation.
const F32_TOLERANCE = 1e-5;

// ---------------------------------------------------------------------------
// Error conservation — total distributed error sums to original
// ---------------------------------------------------------------------------

Deno.test("ElasticDistribution conservation - two links sum to original error", () => {
  const error = 7.5;
  const links: ElasticLink[] = [
    { activation: 1.5, safeZoneFactor: 0.8 },
    { activation: 2.5, safeZoneFactor: 0.6 },
  ];

  const shares = distributeElasticError(error, links);
  const sum = shares.reduce((a, b) => a + b, 0);

  assertAlmostEquals(
    sum,
    error,
    F32_TOLERANCE,
    "Shares should sum to original error",
  );
});

Deno.test("ElasticDistribution conservation - many links sum to original error", () => {
  const error = 42.0;
  const links: ElasticLink[] = [
    { activation: 0.1, safeZoneFactor: 1.0 },
    { activation: 0.5, safeZoneFactor: 0.9 },
    { activation: 1.0, safeZoneFactor: 0.7 },
    { activation: 2.0, safeZoneFactor: 0.5 },
    { activation: 3.0, safeZoneFactor: 1.0 },
  ];

  const shares = distributeElasticError(error, links);
  const sum = shares.reduce((a, b) => a + b, 0);

  assertAlmostEquals(
    sum,
    error,
    F32_TOLERANCE,
    "Sum must equal original error",
  );
});

Deno.test("ElasticDistribution conservation - negative error is conserved", () => {
  const error = -15.3;
  const links: ElasticLink[] = [
    { activation: 1.0, safeZoneFactor: 1.0 },
    { activation: 2.0, safeZoneFactor: 1.0 },
    { activation: 0.5, safeZoneFactor: 1.0 },
  ];

  const shares = distributeElasticError(error, links);
  const sum = shares.reduce((a, b) => a + b, 0);

  assertAlmostEquals(
    sum,
    error,
    F32_TOLERANCE,
    "Negative error should be conserved",
  );
});

Deno.test("ElasticDistribution conservation - single link gets all error", () => {
  const error = 12.0;
  const shares = distributeElasticError(error, [
    { activation: 5.0, safeZoneFactor: 1.0 },
  ]);

  assertEquals(shares.length, 1);
  assertAlmostEquals(
    shares[0],
    error,
    F32_TOLERANCE,
    "Single link gets all error",
  );
});

Deno.test("ElasticDistribution conservation - weight fallback preserves total", () => {
  const error = 13.7;
  const shares = distributeElasticError(error, [
    { activation: 0, safeZoneFactor: 0, weight: 2 },
    { activation: 0, safeZoneFactor: 0, weight: 5 },
    { activation: 0, safeZoneFactor: 0, weight: 3 },
  ]);

  const sum = shares.reduce((a, b) => a + b, 0);
  assertAlmostEquals(
    sum,
    error,
    F32_TOLERANCE,
    "Weight fallback should conserve total error",
  );
});

// ---------------------------------------------------------------------------
// Proportional distribution based on activation magnitudes
// ---------------------------------------------------------------------------

Deno.test("ElasticDistribution proportional - larger activation gets more error", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1.0, safeZoneFactor: 1.0 },
    { activation: 3.0, safeZoneFactor: 1.0 },
  ]);

  // activation²: 1 and 9, so shares: 1 and 9
  assertAlmostEquals(shares[0], 1.0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 9.0, F32_TOLERANCE);
});

Deno.test("ElasticDistribution proportional - negative activations use magnitude", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: -1.0, safeZoneFactor: 1.0 },
    { activation: -3.0, safeZoneFactor: 1.0 },
  ]);

  // activation²: 1 and 9 (same as positive)
  assertAlmostEquals(shares[0], 1.0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 9.0, F32_TOLERANCE);
});

Deno.test("ElasticDistribution proportional - equal activations produce equal shares", () => {
  const error = 12;
  const shares = distributeElasticError(error, [
    { activation: 2.0, safeZoneFactor: 1.0 },
    { activation: 2.0, safeZoneFactor: 1.0 },
    { activation: 2.0, safeZoneFactor: 1.0 },
  ]);

  assertAlmostEquals(shares[0], 4.0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 4.0, F32_TOLERANCE);
  assertAlmostEquals(shares[2], 4.0, F32_TOLERANCE);
});

// ---------------------------------------------------------------------------
// Safe-zone factor reduces error allocation to saturated neurons
// ---------------------------------------------------------------------------

Deno.test("ElasticDistribution safe zone - zero factor blocks link completely", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1, safeZoneFactor: 0 },
    { activation: 2, safeZoneFactor: 1 },
  ]);

  assertAlmostEquals(shares[0], 0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], error, F32_TOLERANCE);
});

Deno.test("ElasticDistribution safe zone - low factor reduces share", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 2.0, safeZoneFactor: 0.1 },
    { activation: 2.0, safeZoneFactor: 1.0 },
  ]);

  assertGreater(shares[1], shares[0], "Healthy link should get more error");
  assertAlmostEquals(
    shares[0] + shares[1],
    error,
    F32_TOLERANCE,
    "Sum must match error",
  );
});

Deno.test("ElasticDistribution safe zone - factor clamped to [0, 1]", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1.0, safeZoneFactor: 5.0 },
    { activation: 1.0, safeZoneFactor: 1.0 },
  ]);

  assertAlmostEquals(shares[0], 5.0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 5.0, F32_TOLERANCE);
});

Deno.test("ElasticDistribution safe zone - negative factor treated as zero", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1.0, safeZoneFactor: -0.5 },
    { activation: 1.0, safeZoneFactor: 1.0 },
  ]);

  assertAlmostEquals(shares[0], 0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 10, F32_TOLERANCE);
});

// ---------------------------------------------------------------------------
// Fallback when all activations are near-zero
// ---------------------------------------------------------------------------

Deno.test("ElasticDistribution fallback - all scores zero falls back to equal split", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1, safeZoneFactor: 0 },
    { activation: 2, safeZoneFactor: 0 },
  ]);

  assertEquals(shares.length, 2);
  assertAlmostEquals(shares[0], 5, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 5, F32_TOLERANCE);
});

Deno.test("ElasticDistribution fallback - weight-based when activations are zero", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 0, safeZoneFactor: 1, weight: 1 },
    { activation: 0, safeZoneFactor: 1, weight: 3 },
  ]);

  // Weight-based fallback: scores 1²=1 and 3²=9
  assertAlmostEquals(shares[0], 1, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 9, F32_TOLERANCE);
});

Deno.test("ElasticDistribution fallback - equal split when no weights or activations", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 0, safeZoneFactor: 1 },
    { activation: 0, safeZoneFactor: 1 },
    { activation: 0, safeZoneFactor: 1 },
    { activation: 0, safeZoneFactor: 1 },
  ]);

  assertAlmostEquals(shares[0], 2.5, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 2.5, F32_TOLERANCE);
  assertAlmostEquals(shares[2], 2.5, F32_TOLERANCE);
  assertAlmostEquals(shares[3], 2.5, F32_TOLERANCE);
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

Deno.test("ElasticDistribution edge - zero error distributes zeros", () => {
  const shares = distributeElasticError(0, [
    { activation: 1.0, safeZoneFactor: 1.0 },
    { activation: 2.0, safeZoneFactor: 1.0 },
  ]);

  assertAlmostEquals(shares[0], 0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], 0, F32_TOLERANCE);
});

Deno.test("ElasticDistribution edge - empty links returns empty array", () => {
  const shares = distributeElasticError(10, []);
  assertEquals(shares.length, 0);
});

Deno.test("ElasticDistribution edge - non-finite error returns zeros", () => {
  const shares = distributeElasticError(NaN, [
    { activation: 1.0, safeZoneFactor: 1.0 },
  ]);

  assertEquals(shares[0], 0);
});

Deno.test("ElasticDistribution edge - non-finite activation treated as zero score", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: NaN, safeZoneFactor: 1.0 },
    { activation: 2.0, safeZoneFactor: 1.0 },
  ]);

  assertAlmostEquals(shares[0], 0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], error, F32_TOLERANCE);
});

Deno.test("ElasticDistribution edge - non-finite safeZoneFactor treated as zero score", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1.0, safeZoneFactor: NaN },
    { activation: 1.0, safeZoneFactor: 1.0 },
  ]);

  assertAlmostEquals(shares[0], 0, F32_TOLERANCE);
  assertAlmostEquals(shares[1], error, F32_TOLERANCE);
});
