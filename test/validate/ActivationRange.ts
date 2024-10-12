import { assert } from "@std/assert/assert";
import { fail } from "@std/assert/fail";
import { Activations } from "../../src/methods/activations/Activations.ts";

Deno.test("ActivationRange-validate", () => {
  const range = Activations.find("CLIPPED").range;

  const checks = [
    -2,
    2,
    NaN,
    Infinity,
    -Infinity,
  ];

  for (const check of checks) {
    try {
      range.validate(check);
      fail("Expected error");
    } catch (e) {
      const error = e as Error;
      assert(
        error.name === "Error",
        `Unexpected name: ${error.name}`,
      );
    }
  }
  for (const check of checks) {
    try {
      range.validate(check, 1);
      fail("Expected error");
    } catch (e) {
      const error = e as Error;
      assert(
        error.name === "Error",
        `Unexpected name: ${error.name}`,
      );
    }
  }
});

Deno.test("ActivationRange-limit", () => {
  const range = Activations.find("CLIPPED").range;

  const checks = [
    NaN,
    Infinity,
    -Infinity,
  ];

  for (const check of checks) {
    try {
      range.limit(check);
      fail("Expected error");
    } catch (e) {
      const error = e as Error;
      assert(
        error.name === "Error",
        `Unexpected name: ${error.name}`,
      );
    }
  }

  for (const check of checks) {
    try {
      range.limit(check, 1);
      fail("Expected error");
    } catch (e) {
      const error = e as Error;
      assert(
        error.name === "Error",
        `Unexpected name: ${error.name}`,
      );
    }
  }
});
