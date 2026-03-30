import { assertAlmostEquals } from "@std/assert";
import { TAN } from "@methods/activations/types/TAN.ts";

// Squash and unSquash behaviour is covered by:
//   test/methods/activations/EdgeCases.ts (squash at x=0)
//   test/methods/activations/SquashRoundtrip.ts (roundtrip within period)
//   test/methods/activations/UnSquashHintTest.ts (unSquash with hint)
// This file tests TAN-specific simplifyBias behaviour.

Deno.test("TAN: simplifyBias wraps large multiples of π to equivalent position", () => {
  const tan = new TAN();
  assertAlmostEquals(tan.simplifyBias(10 * Math.PI), 0);
});

Deno.test("TAN: simplifyBias preserves values within period", () => {
  const tan = new TAN();
  assertAlmostEquals(tan.simplifyBias(Math.PI / 2), Math.PI / 2);
});
