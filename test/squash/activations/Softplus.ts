import { Softplus } from "../../../src/methods/activations/types/Softplus.ts";
import { assert, assertAlmostEquals, assertThrows } from "@std/assert";

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

    // ✅ Range & finite checks
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(d > 0 && d <= 1, `Derivative out of range at x=${x}: ${d}`);

    // ✅ Round-trip squash ∘ unsquash
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch for x=${x}: y=${y}, y2=${y2}`,
    );

    // ✅ Derivative sensibility: central difference
    const epsilon = 1e-4;
    const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
      (2 * epsilon);

    // Avoid misleading comparison in saturated zones (x ≫ 50)
    if (Math.abs(approx) > 1e-8 && Math.abs(x) < 50) {
      assertAlmostEquals(
        d,
        approx,
        1e-4,
        `Derivative mismatch (numerical) at x=${x}: ${d} vs ${approx}`,
      );
    }
  }
});

Deno.test("Softplus.derivative throws for non-finite inputs", () => {
  const fn = new Softplus();

  assertThrows(() => fn.derivative(NaN), "Non-finite");
  assertThrows(() => fn.derivative(Infinity), "Non-finite");
  assertThrows(() => fn.derivative(-Infinity), "Non-finite");
});
