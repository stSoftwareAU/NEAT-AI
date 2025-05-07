import { assert, assertAlmostEquals } from "@std/assert";
import { Exponential } from "../../../src/methods/activations/types/Exponential.ts";

Deno.test("Exponential: squash and derivative finite and correct", () => {
  const fn = new Exponential();

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
    5,
    10, // This is where exp(x) > cap
    100,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  ];

  for (const x of testCases) {
    const y = fn.squash(x);
    const d = fn.derivative(x);

    assert(Number.isFinite(y), `Non-finite squash at x=${x}: ${y}`);
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);

    if (Math.abs(x) <= 3) {
      const expected = Math.exp(x);
      assertAlmostEquals(y, expected, 1e-10, `Mismatch at x=${x}: squash=${y}`);
      assertAlmostEquals(
        d,
        expected,
        1e-10,
        `Mismatch at x=${x}: derivative=${d}`,
      );
    } else {
      // Don't assert exact value due to clamping
      assert(
        d >= 0 && d <= 50,
        `Derivative out of capped range at x=${x}: ${d}`,
      );
    }
  }
});
