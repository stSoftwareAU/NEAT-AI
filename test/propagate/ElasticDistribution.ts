import { assertAlmostEquals, assertEquals } from "@std/assert";
import { distributeElasticError } from "../../src/propagate/ElasticDistribution.ts";

Deno.test("distributeElasticError: prefers higher-activation links (minimum-change)", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1, safeZoneFactor: 1 },
    { activation: 2, safeZoneFactor: 1 },
  ]);

  // We weight by activation², so scores are 1 and 4 → shares 2 and 8.
  assertEquals(shares.length, 2);
  assertAlmostEquals(shares[0], 2, 1e-12);
  assertAlmostEquals(shares[1], 8, 1e-12);
  assertAlmostEquals(shares[0] + shares[1], error, 1e-12);
});

Deno.test("distributeElasticError: honours safeZoneFactor (can fully block a link)", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1, safeZoneFactor: 0 },
    { activation: 2, safeZoneFactor: 1 },
  ]);

  assertAlmostEquals(shares[0], 0, 1e-12);
  assertAlmostEquals(shares[1], error, 1e-12);
});

Deno.test("distributeElasticError: falls back to equal split when scores are all zero", () => {
  const error = 10;
  const shares = distributeElasticError(error, [
    { activation: 1, safeZoneFactor: 0 },
    { activation: 2, safeZoneFactor: 0 },
  ]);

  assertEquals(shares.length, 2);
  assertAlmostEquals(shares[0], 5, 1e-12);
  assertAlmostEquals(shares[1], 5, 1e-12);
});
