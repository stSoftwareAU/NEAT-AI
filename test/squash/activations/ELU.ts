import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { ELU } from "../../../src/methods/activations/types/ELU.ts";

Deno.test("ELU: squash handles NaN input gracefully", () => {
  const fn = new ELU();

  // Should return 0 for NaN input (not throw or return NaN)
  const result = fn.squash(NaN);
  assertEquals(result, 0, "squash(NaN) should return 0");
  assert(Number.isFinite(result), "squash(NaN) must return a finite value");

  // Also check positive and negative Infinity
  const posInf = fn.squash(Infinity);
  assert(
    Number.isFinite(posInf),
    "squash(Infinity) must return a finite value",
  );

  const negInf = fn.squash(-Infinity);
  assert(
    Number.isFinite(negInf),
    "squash(-Infinity) must return a finite value",
  );
});

Deno.test("ELU: squash, unsquash, and derivative cross-check", () => {
  const fn = new ELU();
  const epsilon = 1e-6;

  const testCases = [-100, -10, -2, -1, -0.1, 0, 0.1, 1, 2, 10, 100];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    // Basic checks
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}`);
    assert(d >= 0, `Negative derivative at x=${x}: ${d}`);

    // Round-trip squash → unsquash → squash
    assertAlmostEquals(
      y,
      y2,
      1e-4,
      `Round-trip mismatch at x=${x}: y=${y} vs y2=${y2}`,
    );

    // Derivative ≈ numerical gradient (only in smoother regions)
    if (Math.abs(x) <= 5) {
      const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
        (2 * epsilon);
      const relErr = Math.abs(d - approx) / (Math.abs(d) + 1e-8);
      assert(
        relErr < 0.1,
        `Derivative mismatch at x=${x}: ${d} vs ${approx} (relErr=${relErr})`,
      );
    }
  }
});
