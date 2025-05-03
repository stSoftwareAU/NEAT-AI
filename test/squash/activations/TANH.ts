import { assert, assertThrows } from "@std/assert";
import { TANH } from "../../../src/methods/activations/types/TANH.ts";

Deno.test("TANH.derivative returns finite value in [0, 1]", () => {
  const tanh = new TANH();

  const testCases = [
    -100,
    -10,
    -2,
    -1,
    -0.5,
    0,
    0.5,
    1,
    2,
    10,
    100,
  ];

  for (const x of testCases) {
    const d = tanh.derivative(x);
    // Should always return a number in [0, 1]
    assert(d >= 0 && d <= 1, `Derivative out of bounds for x=${x}: ${d}`);
  }
});

Deno.test("TANH.derivative throws for non-finite inputs", () => {
  const tanh = new TANH();

  assertThrows(() => tanh.derivative(NaN), "Non-finite");
  assertThrows(() => tanh.derivative(Infinity), "Non-finite");
  assertThrows(() => tanh.derivative(-Infinity), "Non-finite");
});
