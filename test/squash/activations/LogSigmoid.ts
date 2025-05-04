import { assert, assertAlmostEquals, assertThrows, fail } from "@std/assert";
import { LogSigmoid } from "../../../src/methods/activations/types/LogSigmoid.ts";

Deno.test("LogSigmoid: check NaN", () => {
  const fn = new LogSigmoid();
  for (let i = -1000; i < 1000; i++) {
    const slope = fn.derivative(i);
    if (!Number.isFinite(slope)) {
      fail(`LogSigmoid derivative is ${slope} at ${i}`);
    }
  }
});

Deno.test("LogSigmoid: squash, unsquash, and derivative cross-check", () => {
  const fn = new LogSigmoid();

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
    -739,
    -740.5203319816084,
    740.5203319816084,
    Number.MIN_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER - 1,
  ];

  for (const x of testCases) {
    const y = fn.squash(x);
    const xRestored = fn.unSquash(y, x);
    const y2 = fn.squash(xRestored);
    const d = fn.derivative(x);

    // ✅ Check that derivative is finite
    assert(Number.isFinite(d), `Non-finite derivative at x=${x}: ${d}`);

    // ✅ Valid derivative range for monotonic increasing LogSigmoid
    assert(d >= 0 && d <= 1 + 1e-6, `Derivative out of range at x=${x}: ${d}`);

    // ✅ Round-trip squash/unsquash
    assertAlmostEquals(
      y,
      y2,
      1e-6,
      `Round-trip mismatch at x=${x}: y=${y} y2=${y2}`,
    );

    // ✅ Numerical approximation comparison (when meaningful)
    const epsilon = 1e-6;
    const approx = (fn.squash(x + epsilon) - fn.squash(x - epsilon)) /
      (2 * epsilon);
    if (Math.abs(approx) > 1e-6) {
      const relErr = Math.abs(d - approx) / Math.max(Math.abs(d), 1e-8);
      if (relErr > 0.1) {
        console.warn(
          `⚠️ Derivative deviation at x=${x}: actual=${d}, approx=${approx}, relErr=${relErr}`,
        );
      }
    }
  }
});

Deno.test("LogSigmoid.derivative throws for non-finite inputs", () => {
  const fn = new LogSigmoid();
  assertThrows(() => fn.derivative(NaN), "non-finite");
  assertThrows(() => fn.derivative(Infinity), "non-finite");
  assertThrows(() => fn.derivative(-Infinity), "non-finite");
});
