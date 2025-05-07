import { assert, assertAlmostEquals } from "@std/assert";
import { GAUSSIAN } from "../../../src/methods/activations/types/GAUSSIAN.ts";

Deno.test("GAUSSIAN: squash, unsquash, and derivative cross-check", () => {
  const fn = new GAUSSIAN();

  const testCases = [
    Number.MIN_SAFE_INTEGER,
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
    Number.MAX_SAFE_INTEGER,
  ];

  for (const x of testCases) {
    const y = fn.squash(x);
    const d = fn.derivative(x);

    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(y >= 0 && y <= 1, `Squash output out of bounds at x=${x}: ${y}`);
    assert(d >= -1e308 && d <= 1e308, `Derivative too extreme at x=${x}: ${d}`);

    // Only test sign if within stable numerical range
    if (Math.abs(x) < 10) {
      if (x < 0) {
        assert(d > 0, `Expected positive derivative at x=${x}, got ${d}`);
      } else if (x > 0) {
        assert(d < 0, `Expected negative derivative at x=${x}, got ${d}`);
      }
    }

    // Round-trip squash/unsquash
    const restoredX = fn.unSquash(y, x);
    const y2 = fn.squash(restoredX);
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y} vs y2=${y2}`,
    );
  }
});
