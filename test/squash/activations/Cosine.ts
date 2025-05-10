import { assertAlmostEquals } from "@std/assert";
import { Cosine } from "../../../src/methods/activations/types/Cosine.ts";

Deno.test("Cosine: derivative behavior", () => {
  const fn = new Cosine();

  const testCases = [
    -Math.PI,
    -Math.PI / 2,
    -1,
    0,
    1,
    Math.PI / 2,
    Math.PI,
  ];

  for (const x of testCases) {
    const expected = -Math.sin(x);
    const actual = fn.derivative(x);

    assertAlmostEquals(
      actual,
      expected,
      1e-12,
      `Mismatch at x=${x}: expected ${expected}, got ${actual}`,
    );
  }
});
