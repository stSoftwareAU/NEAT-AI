import { assertEquals } from "@std/assert";
import { ABSOLUTE } from "../../../src/methods/activations/types/ABSOLUTE.ts";

Deno.test("ABSOLUTE: derivative behavior", () => {
  const fn = new ABSOLUTE();

  const cases: [number, number][] = [
    [-100, -1],
    [-1, -1],
    [-0.00001, -1],
    [0, 0],
    [0.00001, 1],
    [1, 1],
    [100, 1],
  ];

  for (const [x, expected] of cases) {
    const result = fn.derivative(x);
    assertEquals(result, expected, `Expected derivative(${x}) = ${expected}`);
  }
});
