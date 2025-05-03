import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { ISRU } from "../../../src/methods/activations/types/ISRU.ts";

Deno.test("ISRU: squash, unsquash, and derivative cross-check", () => {
  const fn = new ISRU();

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
    -9007199254740991,
    -Number.MIN_VALUE,
    Number.MIN_VALUE,
    9007199254740991,
  ];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    // Derivative must be finite and positive (ISRU is monotonic)
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(d >= 0, `Expected non-negative derivative at x=${x}, got ${d}`);

    // Round-trip consistency
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y}, y2=${y2}`,
    );

    // Derivative sensibility check
    const epsilon = 1e-6;
    const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
      (2 * epsilon);
    if (Math.abs(approx) > 1e-8) {
      assertAlmostEquals(
        d,
        approx,
        1e-4,
        `Derivative mismatch (numerical) at x=${x}: ${d} vs ${approx}`,
      );
    }
  }
});

Deno.test("ISRU.derivative throws for non-finite input", () => {
  const fn = new ISRU();

  assertThrows(() => fn.derivative(NaN), "non-finite");
  assertThrows(() => fn.derivative(Infinity), "non-finite");
  assertThrows(() => fn.derivative(-Infinity), "non-finite");
});
