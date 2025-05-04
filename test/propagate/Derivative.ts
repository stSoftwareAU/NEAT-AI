import { assertAlmostEquals } from "@std/assert/almost-equals";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { calculateDerivativeError } from "../../src/propagate/BackPropagation.ts";
import { RELU } from "../../src/methods/activations/types/RELU.ts";

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
    11.47,
    0.01,
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

const ReLU = new RELU();

Deno.test("ReLU - normal positive value uses derivative", () => {
  const err = calculateDerivativeError(ReLU, 0.5, 0.7);
  assertAlmostEquals(err, 0.2 * 1, 1e-6);
});

Deno.test("ReLU - negative raw value triggers fallback", () => {
  const err = calculateDerivativeError(ReLU, 0, 1); // activation is 0 → raw input ≤ 0
  assertAlmostEquals(err, 1.0, 1e-6); // fallback = target - current (1 - 0)
});

Deno.test("ReLU - zero slope triggers fallback", () => {
  const err = calculateDerivativeError(ReLU, 0.00000001, 0.9);
  assertAlmostEquals(err, 0.9 - 0.00000001, 1e-6); // fallback again
});

Deno.test("ReLU - dead neuron (raw input deeply negative)", () => {
  const err = calculateDerivativeError(ReLU, 0, 0.5);
  assertAlmostEquals(err, 0.5, 1e-6); // fallback logic
});
