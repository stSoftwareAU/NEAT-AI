import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  hasSimplifyBias,
  hasUnSquash,
} from "@methods/activations/TypeGuards.ts";
import { Activations } from "@methods/activations/Activations.ts";

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
  assertEquals(hasUnSquash(activation), true, "StdInverse must have unSquash");
  if (hasUnSquash(activation)) {
    // After narrowing, unSquash should be callable and return a finite number.
    // StdInverse.squash(x) = 1/x, so unSquash(0.5) should give 2 (i.e. 1/0.5)
    const result = activation.unSquash(0.5);
    assertAlmostEquals(result, 2, 1e-6);
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
  assertEquals(
    hasSimplifyBias(activation),
    true,
    "SINE must have simplifyBias",
  );
  if (hasSimplifyBias(activation)) {
    // After narrowing, simplifyBias should be callable and return a finite number.
    // 0.5 is within the period, so it should be preserved
    const result = activation.simplifyBias(0.5);
    assertAlmostEquals(result, 0.5, 1e-6);
  }
});
