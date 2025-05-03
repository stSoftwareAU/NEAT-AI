import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { Mish } from "../../../src/methods/activations/types/Mish.ts";

Deno.test("Mish: squash, unsquash, and derivative cross-check", () => {
  const fn = new Mish();
  const epsilon = 1e-6;

  const testCases = [-100, -10, -2, -1, -0.1, 0, 0.1, 1, 2, 10, 100];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    // ✅ Derivative must be finite and non-negative
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}`);
    assert(d >= 0, `Negative derivative at x=${x}: ${d}`);

    // ✅ Round-trip squash → unsquash → squash
    assertAlmostEquals(
      y,
      y2,
      1e-4,
      `Round-trip mismatch at x=${x}: y=${y} vs y2=${y2}`,
    );

    // ✅ Compare to numerical gradient only in central region
    if (Math.abs(x) <= 1.5) {
      const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
        (2 * epsilon);
      const relErr = Math.abs(d - approx) / (Math.abs(d) + 1e-8);

      assert(
        relErr < 0.15,
        `Derivative mismatch at x=${x}: ${d} vs ${approx} (relErr=${relErr})`,
      );
    }
  }
});

Deno.test("Mish.derivative throws for non-finite inputs", () => {
  const fn = new Mish();

  assertThrows(() => fn.derivative(NaN), "Non-finite");
  assertThrows(() => fn.derivative(Infinity), "Non-finite");
  assertThrows(() => fn.derivative(-Infinity), "Non-finite");
});
