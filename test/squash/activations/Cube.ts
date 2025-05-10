import { assertAlmostEquals } from "@std/assert";
import { Cube } from "../../../src/methods/activations/types/Cube.ts";

Deno.test("Cube: derivative behavior", () => {
  const fn = new Cube();

  const testCases = [
    -100,
    -10,
    -2,
    -1,
    -0.1,
    0,
    0.1,
    1,
    2,
    10,
    100,
  ];

  for (const x of testCases) {
    const expected = 3 * x * x;
    const actual = fn.derivative(x);

    assertAlmostEquals(
      actual,
      expected,
      1e-12,
      `Mismatch at x=${x}: expected ${expected}, got ${actual}`,
    );
  }
});
