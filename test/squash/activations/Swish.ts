import { assert } from "@std/assert";
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

Deno.test("Swish.squash: large negative inputs approach 0 (regression)", () => {
  const swish = new Swish();

  // For x << 0, sigmoid(x) -> 0 and swish(x) = x * sigmoid(x) -> 0.
  // This guards against overflow-handling bugs that incorrectly return ~x.
  const testCases = [-1000, -200, -100, -50, -25];
  for (const x of testCases) {
    const y = swish.squash(x);
    // Should be very close to 0 (and certainly not close to x).
    if (!(Math.abs(y) < 1e-3)) {
      throw new Error(`Expected Swish(${x}) to be near 0, got ${y}`);
    }
  }
});
