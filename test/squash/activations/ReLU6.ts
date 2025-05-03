import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { ReLU6 } from "../../../src/methods/activations/types/ReLU6.ts";

Deno.test("ReLU6: squash, unsquash, and derivative cross-check", () => {
  const fn = new ReLU6();

  const testCases = [
    -100,
    -1,
    0,
    0.1,
    3,
    5.9999,
    6,
    7,
    100,
  ];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y, x);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assert(d === 0 || d === 1, `Unexpected derivative at x=${x}: ${d}`);

    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y} y2=${y2}`,
    );

    const expected = x > 0 && x < 6 ? 1 : 0;
    assert(
      d === expected,
      `Derivative mismatch at x=${x}: ${d} vs ${expected}`,
    );
  }
});

Deno.test("ReLU6.derivative throws for non-finite inputs", () => {
  const fn = new ReLU6();

  assertThrows(() => fn.derivative(NaN), "Non-finite");
  assertThrows(() => fn.derivative(Infinity), "Non-finite");
  assertThrows(() => fn.derivative(-Infinity), "Non-finite");
});
