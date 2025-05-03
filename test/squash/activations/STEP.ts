import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { STEP } from "../../../src/methods/activations/types/STEP.ts";

Deno.test("STEP: squash, unsquash, and derivative cross-check", () => {
  const fn = new STEP();

  const testCases = [
    -100,
    -10,
    -1,
    -0.1,
    0,
    0.1,
    1,
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
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y} y2=${y2}`,
    );

    // Expected behavior:
    // - Near 0: small non-zero derivative (e.g. 0.01)
    // - Elsewhere: zero derivative
    if (Math.abs(x) < 1e-3) {
      assertAlmostEquals(
        d,
        0.01,
        1e-6,
        `Expected derivative ~0.01 at x=${x}, got ${d}`,
      );
    } else {
      assertAlmostEquals(
        d,
        0,
        1e-6,
        `Expected derivative ~0 at x=${x}, got ${d}`,
      );
    }
  }
});

Deno.test("STEP.derivative throws for non-finite inputs", () => {
  const fn = new STEP();

  assertThrows(() => fn.derivative(NaN), "non-finite");
  assertThrows(() => fn.derivative(Infinity), "non-finite");
  assertThrows(() => fn.derivative(-Infinity), "non-finite");
});
