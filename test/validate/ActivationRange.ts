import { assert, assertEquals, fail } from "@std/assert";
import { Activations } from "../../src/methods/activations/Activations.ts";

Deno.test("ActivationRange validate rejects out-of-range and non-finite values", () => {
  const range = Activations.find("CLIPPED").range;

  const invalidValues = [
    -2,
    2,
    NaN,
    Infinity,
    -Infinity,
  ];

  for (const value of invalidValues) {
    // Without neuron index
    try {
      range.validate(value);
      fail(`Expected error for value ${value}`);
    } catch (e) {
      const error = e as Error;
      assert(
        error.name === "ActivationError",
        `Unexpected name: ${error.name}`,
      );
    }

    // With neuron index
    try {
      range.validate(value, 1);
      fail(`Expected error for value ${value} with index 1`);
    } catch (e) {
      const error = e as Error;
      assert(
        error.name === "ActivationError",
        `Unexpected name for indexed validate: ${error.name}`,
      );
    }
  }
});

Deno.test("ActivationRange validate accepts in-range values", () => {
  const range = Activations.find("CLIPPED").range;

  const validValues = [-1, -0.5, 0, 0.5, 1];
  for (const value of validValues) {
    range.validate(value);
  }
});

Deno.test("ActivationRange limit rejects NaN", () => {
  const range = Activations.find("CLIPPED").range;

  try {
    range.limit(NaN);
    fail("Expected error for NaN");
  } catch (e) {
    const error = e as Error;
    assert(
      error.name === "ActivationError",
      `Unexpected name: ${error.name}`,
    );
  }
});

Deno.test("ActivationRange limit clamps out-of-range values", () => {
  const range = Activations.find("CLIPPED").range;

  // Values outside range should be clamped, not throw
  const clamped = range.limit(5);
  assertEquals(clamped, 1);

  const clampedNeg = range.limit(-5);
  assertEquals(clampedNeg, -1);
});
