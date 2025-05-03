import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import { TAN } from "../../../src/methods/activations/types/TAN.ts";

Deno.test("TAN: squash, unsquash, and derivative cross-check", () => {
  const fn = new TAN();

  const testCases = [
    -10,
    -Math.PI / 2 + 0.01,
    -1,
    -0.5,
    0,
    0.5,
    1,
    Math.PI / 2 - 0.01,
    10,
    Number.MIN_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER - 1,
  ];

  for (const x of testCases) {
    // tan(x) has discontinuities at odd multiples of π/2
    if (Math.abs(x % Math.PI) === Math.PI / 2) continue;

    const y = fn.squash(x);
    const xRestored = fn.unSquash(y, x);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    assert(Number.isFinite(y), `Non-finite squash output at x=${x}: y=${y}`);
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y}, y2=${y2}`,
    );

    const epsilon = 1e-6;
    const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
      (2 * epsilon);
    if (Math.abs(approx) < 1e-3 || Math.abs(approx) > 50) continue; // skip unstable
    assertAlmostEquals(
      d,
      approx,
      1e-2,
      `Derivative mismatch at x=${x}: ${d} vs ${approx}`,
    );
  }
});
Deno.test("TAN.derivative throws for non-finite inputs", () => {
  const fn = new TAN();

  assertThrows(() => fn.derivative(NaN), "non-finite");
  assertThrows(() => fn.derivative(Infinity), "non-finite");
  assertThrows(() => fn.derivative(-Infinity), "non-finite");
});
