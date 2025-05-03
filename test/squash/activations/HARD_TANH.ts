import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { HARD_TANH } from "../../../src/methods/activations/types/HARD_TANH.ts";

Deno.test("HARD_TANH: squash, unsquash, and derivative cross-check", () => {
  const fn = new HARD_TANH();

  const testCases = [-100, -2, -1, -0.5, 0, 0.5, 1, 2, 100];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y, x);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);

    // Should be 1 in linear region, 0 outside
    if (x > -1 && x < 1) {
      assertAlmostEquals(
        d,
        1,
        1e-10,
        `Expected derivative 1 in linear region at x=${x}`,
      );
    } else {
      assertAlmostEquals(
        d,
        0,
        1e-10,
        `Expected derivative 0 outside linear region at x=${x}`,
      );
    }

    // Round-trip consistency
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y} y2=${y2}`,
    );
  }
});

Deno.test("HARD_TANH.derivative throws on non-finite", () => {
  const fn = new HARD_TANH();
  assertThrows(() => fn.derivative(NaN));
  assertThrows(() => fn.derivative(Infinity));
  assertThrows(() => fn.derivative(-Infinity));
});
