import { assertAlmostEquals, assertEquals } from "@std/assert";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";

Deno.test("GELU squash range", () => {
  const gelu = new GELU();

  // Test very large negative values
  assertEquals(gelu.squash(-100), 0);
  assertEquals(gelu.squash(-1000), 0);
  assertEquals(gelu.squash(-10000), 0);

  // Test very large positive values
  assertAlmostEquals(gelu.squash(100), 100, 0.1);
  assertAlmostEquals(gelu.squash(1000), 1000, 0.1);
  assertAlmostEquals(gelu.squash(10000), 10000, 0.1);

  // Test the range limits
  const range = gelu.range;
  console.log("GELU range:", range.low, "to", range.high);

  // Test that the range matches the actual squash behavior
  assertEquals(gelu.squash(Number.MIN_SAFE_INTEGER), 0);
  assertEquals(gelu.squash(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
});
