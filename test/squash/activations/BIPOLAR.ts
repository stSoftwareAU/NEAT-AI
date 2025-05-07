import { assert, assertAlmostEquals } from "@std/assert";
import { BIPOLAR } from "../../../src/methods/activations/types/BIPOLAR.ts";

Deno.test("BIPOLAR: squash, unsquash, and derivative cross-check", () => {
  const fn = new BIPOLAR();

  const testCases = [
    -100,
    -1,
    -0.1,
    0,
    0.1,
    1,
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
  }
});
