import { assertAlmostEquals } from "@std/assert/almost-equals";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { calculateDerivativeError } from "../../src/propagate/BackPropagation.ts";

Deno.test("Derivative error calculation worked example", () => {
  const fn = new TANH();

  const error = calculateDerivativeError(
    fn,
    -1,
    0.9,
    -10,
  );

  assertAlmostEquals(
    error,
    0,
    1e-6,
    `Derivative error mismatch: ${error}`,
  );
});

Deno.test("TANH - mid-range activation", () => {
  const err = calculateDerivativeError(new TANH(), 0.5, 0.6);
  assertAlmostEquals(err, (0.6 - 0.5) * (1 - 0.25), 1e-6); // tanh'(0.5) = 1 - tanh^2(0.5)
});

Deno.test("TANH - activation near saturation", () => {
  const err = calculateDerivativeError(new TANH(), 0.999999, -0.999999);
  assertAlmostEquals(err, (-0.999999 - 0.999999) * 0, 1e-5); // slope nearly zero
});

Deno.test("TANH - activation at zero", () => {
  const err = calculateDerivativeError(new TANH(), 0, 0.5);
  assertAlmostEquals(err, 0.5 * 1, 1e-6); // tanh(0) = 0, tanh'(0) = 1
});
