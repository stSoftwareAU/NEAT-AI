import { assertAlmostEquals } from "@std/assert";
import { TAN } from "../../src/methods/activations/types/TAN.ts";

Deno.test("TAN", () => {
  const tan = new TAN();

  // Test squash
  assertAlmostEquals(tan.squash(0), 0);
  assertAlmostEquals(tan.squash(Math.PI / 4), 1);
  assertAlmostEquals(tan.squash(-Math.PI / 4), -1);

  // Test unSquash
  assertAlmostEquals(tan.unSquash(1), Math.PI / 4); // ~π/4
  assertAlmostEquals(tan.unSquash(-1), -Math.PI / 4); // ~-π/4
  assertAlmostEquals(tan.unSquash(1, 5), Math.PI / 4 + Math.PI); // ~π/4 + nearestMultipleOf π close to 5

  // Test simplifyBias
  assertAlmostEquals(tan.simplifyBias(10 * Math.PI), 0); // Expected: 0 (equivalent position)
  assertAlmostEquals(tan.simplifyBias(Math.PI / 2), Math.PI / 2); // Expected: π/2
});
