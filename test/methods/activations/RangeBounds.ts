/**
 * Unit tests for activation function range bounds compliance.
 *
 * For each activation function, verify that squash(x) stays within the
 * declared range for a variety of inputs including extreme values.
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

/** All activation names to test (the 31 from the issue + ABSOLUTE). */
const ALL_ACTIVATION_NAMES: string[] = [
  "ABSOLUTE",
  "ArcTan",
  "BENT_IDENTITY",
  "BIPOLAR",
  "BIPOLAR_SIGMOID",
  "COMPLEMENT",
  "Cosine",
  "Cube",
  "ELU",
  "Exponential",
  "GAUSSIAN",
  "GELU",
  "HARD_TANH",
  "IDENTITY",
  "ISRU",
  "LeakyReLU",
  "LOGISTIC",
  "LogSigmoid",
  "Mish",
  "ReLU",
  "ReLU6",
  "SELU",
  "SINE",
  "Softplus",
  "SOFTSIGN",
  "SQRT",
  "SQUARE",
  "StdInverse",
  "STEP",
  "Swish",
  "TAN",
  "TANH",
];

/** Wide range of test inputs covering normal and extreme values. */
const TEST_INPUTS: number[] = [
  -1e6,
  -1000,
  -100,
  -10,
  -5,
  -2,
  -1,
  -0.5,
  -0.1,
  -0.01,
  0,
  0.01,
  0.1,
  0.5,
  1,
  2,
  5,
  10,
  100,
  1000,
  1e6,
];

for (const name of ALL_ACTIVATION_NAMES) {
  Deno.test(`${name}: squash output within declared range`, () => {
    const activation = Activations.find(name);
    const squashFn = activation as unknown as ActivationInterface;
    const low = activation.range.low;
    const high = activation.range.high;

    for (const x of TEST_INPUTS) {
      const result = squashFn.squash(x);

      assert(
        Number.isFinite(result),
        `${name}: squash(${x}) = ${result}, expected finite`,
      );
      assert(
        result >= low,
        `${name}: squash(${x}) = ${result} < range low ${low}`,
      );
      assert(
        result <= high,
        `${name}: squash(${x}) = ${result} > range high ${high}`,
      );
    }
  });
}

// --- Specific range verification ---

Deno.test("LOGISTIC: range is (0, 1)", () => {
  const activation = Activations.find("LOGISTIC");
  assertEquals(activation.range.low, 0);
  assertEquals(activation.range.high, 1);
});

Deno.test("TANH: range is (-1, 1)", () => {
  const activation = Activations.find("TANH");
  assertEquals(activation.range.low, -1);
  assertEquals(activation.range.high, 1);
});

Deno.test("ReLU: range is (0, MAX_SAFE_INTEGER)", () => {
  const activation = Activations.find("ReLU");
  assertEquals(activation.range.low, 0);
  assertEquals(activation.range.high, Number.MAX_SAFE_INTEGER);
});

Deno.test("ReLU6: range is (0, 6)", () => {
  const activation = Activations.find("ReLU6");
  assertEquals(activation.range.low, 0);
  assertEquals(activation.range.high, 6);
});

Deno.test("HARD_TANH: range is (-1, 1)", () => {
  const activation = Activations.find("HARD_TANH");
  assertEquals(activation.range.low, -1);
  assertEquals(activation.range.high, 1);
});

Deno.test("ArcTan: range is (-π/2, π/2)", () => {
  const activation = Activations.find("ArcTan");
  assertEquals(activation.range.low, -Math.PI / 2);
  assertEquals(activation.range.high, Math.PI / 2);
});

Deno.test("GAUSSIAN: range is (0, 1)", () => {
  const activation = Activations.find("GAUSSIAN");
  assertEquals(activation.range.low, 0);
  assertEquals(activation.range.high, 1);
});

Deno.test("SINE: range is (-1, 1)", () => {
  const activation = Activations.find("SINE");
  assertEquals(activation.range.low, -1);
  assertEquals(activation.range.high, 1);
});

Deno.test("Cosine: range is (-1, 1)", () => {
  const activation = Activations.find("Cosine");
  assertEquals(activation.range.low, -1);
  assertEquals(activation.range.high, 1);
});

Deno.test("BIPOLAR: range is (-1, 1)", () => {
  const activation = Activations.find("BIPOLAR");
  assertEquals(activation.range.low, -1);
  assertEquals(activation.range.high, 1);
});

Deno.test("STEP: range is (0, 1)", () => {
  const activation = Activations.find("STEP");
  assertEquals(activation.range.low, 0);
  assertEquals(activation.range.high, 1);
});

Deno.test("Exponential: range is (0, MAX_SAFE_INTEGER)", () => {
  const activation = Activations.find("Exponential");
  assertEquals(activation.range.low, 0);
  assertEquals(activation.range.high, Number.MAX_SAFE_INTEGER);
});
