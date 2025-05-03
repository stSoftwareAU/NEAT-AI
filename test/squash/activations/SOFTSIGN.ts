import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { SOFTSIGN } from "../../../src/methods/activations/types/SOFTSIGN.ts";

Deno.test("SOFTSIGN: squash, unsquash, and derivative cross-check", () => {
  const fn = new SOFTSIGN();

  const testCases = [-100, -10, -2, -1, -0.1, 0, 0.1, 1, 2, 10, 100];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y, x);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(d > 0 && d <= 1, `Unexpected derivative at x=${x}: ${d}`);

    assertAlmostEquals(y, y2, 1e-6, `Round-trip mismatch at x=${x}`);

    // Check numerical consistency if slope is steep enough
    const epsilon = 1e-6;
    const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
      (2 * epsilon);
    if (Math.abs(approx) > 1e-8) {
      assertAlmostEquals(
        d,
        approx,
        1e-3,
        `Derivative mismatch at x=${x}: ${d} vs ${approx}`,
      );
    }
  }
});

Deno.test("SOFTSIGN.derivative throws on non-finite", () => {
  const fn = new SOFTSIGN();
  assertThrows(() => fn.derivative(NaN));
  assertThrows(() => fn.derivative(Infinity));
  assertThrows(() => fn.derivative(-Infinity));
});
