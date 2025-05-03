import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { COMPLEMENT } from "../../../src/methods/activations/types/COMPLEMENT.ts";

Deno.test("COMPLEMENT: squash, unsquash, and derivative cross-check", () => {
  const fn = new COMPLEMENT();

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
    assertAlmostEquals(
      d,
      -1,
      1e-12,
      `Expected derivative to be -1 at x=${x}, got ${d}`,
    );
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y} y2=${y2}`,
    );

    // Numerical approximation check
    const epsilon = 1e-6;
    const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
      (2 * epsilon);
    if (Math.abs(x) < 1e6) {
      assertAlmostEquals(
        d,
        approx,
        1e-4,
        `Derivative mismatch at x=${x}: ${d} vs ${approx}`,
      );
    }
  }
});

Deno.test("COMPLEMENT.derivative throws for non-finite inputs", () => {
  const fn = new COMPLEMENT();

  assertThrows(() => fn.derivative(NaN), "non-finite");
  assertThrows(() => fn.derivative(Infinity), "non-finite");
  assertThrows(() => fn.derivative(-Infinity), "non-finite");
});
