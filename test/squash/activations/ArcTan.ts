import { assert, assertAlmostEquals } from "@std/assert";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";

Deno.test("ArcTan: squash, unsquash, and derivative cross-check", () => {
  const fn = new ArcTan();

  const testCases = [-100, -10, -2, -1, -0.1, 0, 0.1, 1, 2, 10, 100];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    // Derivative should always be finite and in (0, 2/π]
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(
      d > 0 && d <= 2 / Math.PI,
      `Derivative out of range at x=${x}: ${d}`,
    );

    // Round-trip check
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y} y2=${y2}`,
    );

    // Correct derivative formula: (2 / π) * (1 / (1 + x²))
    const expected = (2 / Math.PI) * (1 / (1 + x * x));
    assertAlmostEquals(
      d,
      expected,
      1e-6,
      `Derivative mismatch at x=${x}: ${d} vs ${expected}`,
    );
  }
});
