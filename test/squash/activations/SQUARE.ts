// SQUARE_test.ts
import { assertAlmostEquals } from "@std/assert";
import { SQUARE } from "../../../src/methods/activations/types/SQUARE.ts";

Deno.test("SQUARE: squash", () => {
  const fn = new SQUARE();
  const testCases = [-3, -1, 0, 1, 2, 10];
  for (const x of testCases) {
    const y = fn.squash(x);
    assertAlmostEquals(y, x * x, 1e-10);
  }
});

Deno.test("SQUARE: derivative", () => {
  const fn = new SQUARE();
  const testCases = [-3, -1, 0, 1, 2, 10];
  for (const x of testCases) {
    const d = fn.derivative(x);
    assertAlmostEquals(d, 2 * x, 1e-10);
  }
});

Deno.test("SQUARE: calculateError", () => {
  const fn = new SQUARE();
  const x = 3;
  const target = 10;
  const current = x * x;
  const err = fn.calculateError(current, target, x);
  const expected = Math.sqrt(target) - x;
  assertAlmostEquals(err, expected, 1e-2);
});
