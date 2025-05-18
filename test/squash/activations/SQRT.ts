// SQRT_test.ts
import { assertAlmostEquals } from "@std/assert";
import { SQRT } from "../../../src/methods/activations/types/SQRT.ts";

Deno.test("SQRT: squash", () => {
  const fn = new SQRT();
  const cases = [0, 0.0001, 1, 4, 100, Number.MAX_SAFE_INTEGER];
  for (const x of cases) {
    const y = fn.squash(x);
    assertAlmostEquals(y, Math.sqrt(x), 1e-10);
  }
});

Deno.test("SQRT: derivative", () => {
  const fn = new SQRT();
  const cases = [0.0001, 1, 4, 100];
  for (const x of cases) {
    const d = fn.derivative(x);
    assertAlmostEquals(d, 1 / (2 * Math.sqrt(x)), 1e-10);
  }
});

Deno.test("SQRT: unSquash", () => {
  const fn = new SQRT();
  const cases = [0, 1, 3, 10];
  for (const y of cases) {
    const x = fn.unSquash(y);
    assertAlmostEquals(x, y * y, 1e-10);
  }
});

Deno.test("SQRT: calculateError with stable slope", () => {
  const fn = new SQRT();
  const currentValue = 4;
  const act = fn.squash(currentValue);
  const target = fn.squash(9);
  const slope = fn.derivative(currentValue);
  const expected = (target - act) / slope;
  const err = fn.calculateError(act, target, currentValue);
  assertAlmostEquals(err, expected, 1e-6);
});

Deno.test("SQRT: calculateError with fallback", () => {
  const fn = new SQRT();
  const currentValue = 0;
  const targetValue = fn.unSquash(3);
  const err = fn.calculateError(0, 3, currentValue);
  const expected = targetValue - currentValue;
  assertAlmostEquals(err, expected, 1e-6);
});
