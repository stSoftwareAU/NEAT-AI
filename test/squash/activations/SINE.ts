import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { SINE } from "../../../src/methods/activations/types/SINE.ts";

Deno.test("SINE: squash, unsquash, and derivative cross-check", () => {
  const fn = new SINE();

  const testCases = [
    -100,
    -10,
    -Math.PI,
    -1,
    -0.5,
    0,
    0.5,
    1,
    Math.PI,
    10,
    100,
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

    const expected = Math.cos(x);
    assertAlmostEquals(
      d,
      expected,
      1e-6,
      `Derivative mismatch at x=${x}: ${d} vs ${expected}`,
    );
  }
});

Deno.test("SINE.derivative throws for non-finite inputs", () => {
  const fn = new SINE();

  assertThrows(() => fn.derivative(NaN), "Non-finite");
  assertThrows(() => fn.derivative(Infinity), "Non-finite");
  assertThrows(() => fn.derivative(-Infinity), "Non-finite");
});
