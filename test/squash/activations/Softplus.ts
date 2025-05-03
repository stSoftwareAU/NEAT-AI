import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { Softplus } from "../../../src/methods/activations/types/Softplus.ts";

Deno.test("Softplus: squash, unsquash, and derivative cross-check", () => {
  const fn = new Softplus();

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

    // Derivative is always in (0, 1)
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(d > 0 && d < 1, `Derivative out of range at x=${x}: ${d}`);

    // Round-trip: squash ∘ unsquash ≈ identity
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch for x=${x}: y=${y} y2=${y2}`,
    );

    // Derivative consistency: d ≈ sigmoid(x)
    const expected = 1 / (1 + Math.exp(-x));
    assertAlmostEquals(
      d,
      expected,
      1e-10,
      `Derivative mismatch at x=${x}: ${d} vs ${expected}`,
    );
  }
});

Deno.test("Softplus.derivative throws for non-finite inputs", () => {
  const fn = new Softplus();

  assertThrows(() => fn.derivative(NaN), "Non-finite");
  assertThrows(() => fn.derivative(Infinity), "Non-finite");
  assertThrows(() => fn.derivative(-Infinity), "Non-finite");
});
