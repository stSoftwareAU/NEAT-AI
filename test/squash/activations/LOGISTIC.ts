import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { LOGISTIC } from "../../../src/methods/activations/types/LOGISTIC.ts";

Deno.test("LOGISTIC: squash, unsquash, and derivative cross-check", () => {
  const fn = new LOGISTIC();

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
  ];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    // Core range checks
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(d >= 0 && d <= 0.25, `Derivative out of range at x=${x}: ${d}`);

    // Round-trip check: squash ∘ unsquash
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch for x=${x}: y=${y} y2=${y2}`,
    );

    // Identity of derivative formula: f'(x) ≈ y * (1 - y)
    const expected = y * (1 - y);
    assertAlmostEquals(
      d,
      expected,
      1e-10,
      `Derivative mismatch for x=${x}: ${d} vs ${expected}`,
    );
  }
});

Deno.test("LOGISTIC.derivative throws for non-finite inputs", () => {
  const fn = new LOGISTIC();

  assertThrows(() => fn.derivative(NaN), "Non-finite");
  assertThrows(() => fn.derivative(Infinity), "Non-finite");
  assertThrows(() => fn.derivative(-Infinity), "Non-finite");
});
