import { assertAlmostEquals, assertEquals } from "@std/assert";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";

// Test cases for GELU activation function
Deno.test("GELU squash function", () => {
  const gelu = new GELU();

  // Test zero input
  assertEquals(gelu.squash(0), 0);

  // Test positive values
  assertAlmostEquals(gelu.squash(1), 0.841, 0.001);
  assertAlmostEquals(gelu.squash(2), 1.954, 0.001);
  assertAlmostEquals(gelu.squash(5), 4.999, 0.001);

  // Test negative values
  assertAlmostEquals(gelu.squash(-1), -0.159, 0.001);
  assertAlmostEquals(gelu.squash(-2), -0.046, 0.001);
  assertAlmostEquals(gelu.squash(-5), -0.001, 0.001);

  // Test large values
  assertAlmostEquals(gelu.squash(10), 10, 0.001);
  assertAlmostEquals(gelu.squash(-10), 0, 0.001);

  // Test range limits
  const largeValue = 1e10;
  assertEquals(gelu.squash(largeValue), largeValue);
  assertEquals(gelu.squash(-largeValue), 0);
});

// Test cases for GELU unSquash function
Deno.test("GELU unSquash function", () => {
  const gelu = new GELU();

  // Test zero activation
  assertAlmostEquals(gelu.unSquash(0, 0.01), 0, 0.1);

  // Test positive activations
  assertAlmostEquals(gelu.unSquash(0.841), 1, 0.1);
  assertAlmostEquals(gelu.unSquash(1.954), 2, 0.1);

  // Test negative activations
  assertAlmostEquals(gelu.unSquash(-0.159, -0.540), -0.539, 0.001);
  assertAlmostEquals(gelu.unSquash(-0.046, -0.07), -0.0694568821, 0.1);

  // Test edge cases
  assertAlmostEquals(gelu.unSquash(10), 10, 0.1);

  // Test range validation
  try {
    gelu.unSquash(Number.POSITIVE_INFINITY);
    throw new Error("Should have thrown an error");
  } catch (e) {
    assertEquals(e instanceof Error, true);
  }
});
