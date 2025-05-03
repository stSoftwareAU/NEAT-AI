import { assert, assertThrows } from "@std/assert";
import { Swish } from "../../../src/methods/activations/types/Swish.ts";

Deno.test("Swish.derivative returns finite values", () => {
  const swish = new Swish();

  const testCases: number[] = [
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
    const result = swish.derivative(x);
    assert(Number.isFinite(result), `Non-finite result for x=${x}: ${result}`);
  }
});

Deno.test("Swish.derivative throws for NaN, Infinity", () => {
  const swish = new Swish();

  assertThrows(() => swish.derivative(NaN), "Non-finite");
  assertThrows(() => swish.derivative(Infinity), "Non-finite");
  assertThrows(() => swish.derivative(-Infinity), "Non-finite");
});
