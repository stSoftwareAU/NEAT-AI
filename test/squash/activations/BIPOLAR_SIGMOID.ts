import { assert, assertAlmostEquals } from "@std/assert";
import { BIPOLAR_SIGMOID } from "../../../src/methods/activations/types/BIPOLAR_SIGMOID.ts";

Deno.test("BIPOLAR_SIGMOID: squash, unsquash, and derivative cross-check", () => {
  const fn = new BIPOLAR_SIGMOID();

  const testCases = [
    -100,
    -10,
    -2,
    -1,
    0,
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
      y,
      y2,
      1e-5,
      `Round-trip mismatch at x=${x}: y=${y} y2=${y2}`,
    );

    const epsilon = 1e-6;
    const numerical = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
      (2 * epsilon);
    assertAlmostEquals(
      d,
      numerical,
      1e-2,
      `Derivative mismatch at x=${x}: ${d} vs ${numerical}`,
    );
  }
});
