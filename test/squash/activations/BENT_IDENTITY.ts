import { assert, assertAlmostEquals } from "@std/assert";
import { BENT_IDENTITY } from "../../../src/methods/activations/types/BENT_IDENTITY.ts";

Deno.test("BENT_IDENTITY: squash, unsquash, and derivative cross-check", () => {
  const fn = new BENT_IDENTITY();

  const testCases = [-100, -10, -2, -1, -0.1, 0, 0.1, 1, 2, 10, 100];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y, x);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);

    // Value range check (should be near 1 when x is large)
    assert(d > 0.5 && d < 1.5, `Unexpected slope at x=${x}: ${d}`);

    // Round-trip squash check
    assertAlmostEquals(y, y2, 1e-6, `Round-trip mismatch at x=${x}`);
  }
});
