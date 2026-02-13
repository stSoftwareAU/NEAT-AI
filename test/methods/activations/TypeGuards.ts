import { assertEquals } from "@std/assert";
import {
  hasSimplifyBias,
  hasUnSquash,
} from "../../../src/methods/activations/TypeGuards.ts";
import { Activations } from "../../../src/methods/activations/Activations.ts";

Deno.test("hasUnSquash returns true for StdInverse", () => {
  const stdInverse = Activations.find("StdInverse");
  assertEquals(hasUnSquash(stdInverse), true);
});

Deno.test("hasUnSquash returns true for ReLU", () => {
  const relu = Activations.find("ReLU");
  assertEquals(hasUnSquash(relu), true);
});

Deno.test("hasUnSquash type guard narrows type correctly", () => {
  const activation = Activations.find("StdInverse");
  if (hasUnSquash(activation)) {
    // After narrowing, unSquash should be callable
    const result = activation.unSquash(0.5);
    assertEquals(typeof result, "number");
    assertEquals(Number.isFinite(result), true);
  }
});

Deno.test("hasSimplifyBias returns true for Cosine", () => {
  // Cosine has a simplifyBias method
  const cosine = Activations.find("Cosine");
  assertEquals(hasSimplifyBias(cosine), true);
});

Deno.test("hasSimplifyBias returns true for SINE", () => {
  const sine = Activations.find("SINE");
  assertEquals(hasSimplifyBias(sine), true);
});

Deno.test("hasSimplifyBias returns false for LOGISTIC", () => {
  const logistic = Activations.find("LOGISTIC");
  assertEquals(hasSimplifyBias(logistic), false);
});

Deno.test("hasSimplifyBias type guard narrows type correctly", () => {
  const activation = Activations.find("SINE");
  if (hasSimplifyBias(activation)) {
    // After narrowing, simplifyBias should be callable
    const result = activation.simplifyBias(0.5);
    assertEquals(typeof result, "number");
  }
});
