/**
 * Unit tests for activation function monotonicity.
 *
 * Most activation functions are monotonically non-decreasing:
 *   if a <= b then squash(a) <= squash(b)
 *
 * Some activations (GAUSSIAN, Cosine, SINE, SQUARE, ABSOLUTE, Mish, Swish,
 * GELU, Cube) are NOT monotonic over the full domain.
 *
 * @module
 */

import { assert } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

/**
 * Activations that should be monotonically non-decreasing over the
 * given input range.
 */
const MONOTONIC_ACTIVATIONS: {
  name: string;
  /** Sorted ascending test inputs within the monotonic domain. */
  inputs: number[];
}[] = [
  { name: "ArcTan", inputs: [-100, -10, -1, 0, 1, 10, 100] },
  {
    name: "BENT_IDENTITY",
    inputs: [-100, -10, -1, 0, 1, 10, 100],
  },
  { name: "ELU", inputs: [-10, -1, 0, 1, 10, 100] },
  { name: "Exponential", inputs: [-10, -1, 0, 1, 5, 10] },
  { name: "HARD_TANH", inputs: [-10, -1, -0.5, 0, 0.5, 1, 10] },
  { name: "IDENTITY", inputs: [-100, -10, -1, 0, 1, 10, 100] },
  { name: "ISRU", inputs: [-10, -1, 0, 1, 10] },
  { name: "LeakyReLU", inputs: [-10, -1, 0, 1, 10, 100] },
  { name: "LOGISTIC", inputs: [-10, -1, 0, 1, 10] },
  { name: "LogSigmoid", inputs: [-10, -1, 0, 1, 10] },
  { name: "ReLU", inputs: [-10, -1, 0, 1, 10, 100] },
  { name: "ReLU6", inputs: [-10, -1, 0, 1, 3, 6, 10] },
  { name: "SELU", inputs: [-10, -1, 0, 1, 10] },
  { name: "Softplus", inputs: [-10, -1, 0, 1, 10] },
  { name: "SOFTSIGN", inputs: [-100, -10, -1, 0, 1, 10, 100] },
  { name: "SQRT", inputs: [0, 0.01, 0.1, 1, 10, 100] },
  { name: "TANH", inputs: [-10, -1, 0, 1, 10] },
  { name: "BIPOLAR_SIGMOID", inputs: [-10, -1, 0, 1, 10] },
];

for (const { name, inputs } of MONOTONIC_ACTIVATIONS) {
  Deno.test(`${name}: monotonically non-decreasing`, () => {
    const activation = Activations.find(name) as unknown as ActivationInterface;

    for (let i = 0; i < inputs.length - 1; i++) {
      const a = inputs[i];
      const b = inputs[i + 1];
      const fa = activation.squash(a);
      const fb = activation.squash(b);

      assert(
        fa <= fb,
        `${name}: squash(${a}) = ${fa} > squash(${b}) = ${fb}, expected non-decreasing`,
      );
    }
  });
}

// --- Non-monotonic activations: verify they have expected non-monotonic behaviour ---

Deno.test("GAUSSIAN: non-monotonic — peaks at x=0", () => {
  const activation = Activations.find(
    "GAUSSIAN",
  ) as unknown as ActivationInterface;

  const at0 = activation.squash(0);
  const at2 = activation.squash(2);
  const atNeg2 = activation.squash(-2);

  // Peak at 0
  assert(at0 > at2, "GAUSSIAN(0) should be greater than GAUSSIAN(2)");
  assert(at0 > atNeg2, "GAUSSIAN(0) should be greater than GAUSSIAN(-2)");
});

Deno.test("Cosine: non-monotonic — oscillates", () => {
  const activation = Activations.find(
    "Cosine",
  ) as unknown as ActivationInterface;

  const at0 = activation.squash(0);
  const atPi = activation.squash(Math.PI);

  assert(at0 > atPi, "Cosine(0) = 1 should be greater than Cosine(π) = -1");
});

Deno.test("SINE: non-monotonic — oscillates", () => {
  const activation = Activations.find("SINE") as unknown as ActivationInterface;

  const atPiHalf = activation.squash(Math.PI / 2);
  const atPi = activation.squash(Math.PI);

  assert(
    atPiHalf > atPi,
    `SINE(π/2) = ${atPiHalf} should be > SINE(π) = ${atPi}`,
  );
});

Deno.test("COMPLEMENT: monotonically decreasing", () => {
  const activation = Activations.find(
    "COMPLEMENT",
  ) as unknown as ActivationInterface;

  const inputs = [-10, -1, 0, 1, 10];
  for (let i = 0; i < inputs.length - 1; i++) {
    const a = inputs[i];
    const b = inputs[i + 1];
    const fa = activation.squash(a);
    const fb = activation.squash(b);

    assert(
      fa >= fb,
      `COMPLEMENT: squash(${a}) = ${fa} < squash(${b}) = ${fb}, expected non-increasing`,
    );
  }
});

Deno.test("BIPOLAR: non-decreasing step function", () => {
  const activation = Activations.find(
    "BIPOLAR",
  ) as unknown as ActivationInterface;

  const atNeg = activation.squash(-5);
  const atPos = activation.squash(5);

  assert(
    atNeg <= atPos,
    `BIPOLAR(-5) = ${atNeg} should be <= BIPOLAR(5) = ${atPos}`,
  );
});

Deno.test("STEP: non-decreasing step function", () => {
  const activation = Activations.find("STEP") as unknown as ActivationInterface;

  const atNeg = activation.squash(-5);
  const atPos = activation.squash(5);

  assert(
    atNeg <= atPos,
    `STEP(-5) = ${atNeg} should be <= STEP(5) = ${atPos}`,
  );
});

Deno.test("ABSOLUTE: non-monotonic — V-shaped", () => {
  const activation = Activations.find(
    "ABSOLUTE",
  ) as unknown as ActivationInterface;

  const atNeg2 = activation.squash(-2);
  const at0 = activation.squash(0);
  const at2 = activation.squash(2);

  // Minimum at 0, increases on both sides
  assert(at0 < atNeg2, "ABSOLUTE(0) should be less than ABSOLUTE(-2)");
  assert(at0 < at2, "ABSOLUTE(0) should be less than ABSOLUTE(2)");
});

Deno.test("SQUARE: non-monotonic — U-shaped", () => {
  const activation = Activations.find(
    "SQUARE",
  ) as unknown as ActivationInterface;

  const atNeg2 = activation.squash(-2);
  const at0 = activation.squash(0);
  const at2 = activation.squash(2);

  // Minimum at 0, increases on both sides
  assert(at0 < atNeg2, "SQUARE(0) should be less than SQUARE(-2)");
  assert(at0 < at2, "SQUARE(0) should be less than SQUARE(2)");
});

Deno.test("StdInverse: monotonically decreasing for positive x", () => {
  const activation = Activations.find(
    "StdInverse",
  ) as unknown as ActivationInterface;

  // 1/x is decreasing for positive x
  const inputs = [0.1, 0.5, 1, 2, 5, 10];
  for (let i = 0; i < inputs.length - 1; i++) {
    const a = inputs[i];
    const b = inputs[i + 1];
    const fa = activation.squash(a);
    const fb = activation.squash(b);

    assert(
      fa >= fb,
      `StdInverse: squash(${a}) = ${fa} < squash(${b}) = ${fb}, expected non-increasing for positive x`,
    );
  }
});
