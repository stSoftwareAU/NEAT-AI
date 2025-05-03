import { assert, assertAlmostEquals } from "@std/assert";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";

Deno.test("IDENTITY: squash, unsquash, and derivative cross-check", () => {
  const fn = new IDENTITY();

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
    Number.MIN_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER - 1,
  ];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y, x);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(d > 0 && d <= 1 + 1e-6, `Derivative out of range at x=${x}: ${d}`);
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y} y2=${y2}`,
    );

    // Skip numerical derivative test for extreme values
    if (Math.abs(x) < 1e6) {
      const epsilon = 1e-6;
      const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
        (2 * epsilon);
      assertAlmostEquals(
        d,
        approx,
        1e-4,
        `Derivative mismatch at x=${x}: ${d} vs ${approx}`,
      );
    }
  }
});
