/**
 * Unit tests for activation function edge-case behaviour.
 *
 * Tests behaviour at:
 * - x = 0 (often a special point)
 * - Large positive and large negative values
 * - Non-finite inputs (NaN, ±Infinity)
 * - Boundary values specific to each activation
 *
 * @module
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

// --- Behaviour at x = 0 ---

Deno.test("ArcTan: squash(0) = 0", () => {
  const a = Activations.find("ArcTan") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("BENT_IDENTITY: squash(0) = 0", () => {
  const a = Activations.find("BENT_IDENTITY") as unknown as ActivationInterface;
  // (sqrt(0 + 1) - 1) / 2 + 0 = 0
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("COMPLEMENT: squash(0) = 1", () => {
  const a = Activations.find("COMPLEMENT") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 1, 1e-10);
});

Deno.test("Cosine: squash(0) = 1", () => {
  const a = Activations.find("Cosine") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 1, 1e-10);
});

Deno.test("Cube: squash(0) = 0", () => {
  const a = Activations.find("Cube") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("ELU: squash(0) = 0", () => {
  const a = Activations.find("ELU") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("Exponential: squash(0) = 1", () => {
  const a = Activations.find("Exponential") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 1, 1e-10);
});

Deno.test("GAUSSIAN: squash(0) = 1", () => {
  const a = Activations.find("GAUSSIAN") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 1, 1e-10);
});

Deno.test("HARD_TANH: squash(0) = 0", () => {
  const a = Activations.find("HARD_TANH") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("IDENTITY: squash(0) = 0", () => {
  const a = Activations.find("IDENTITY") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("LOGISTIC: squash(0) = 0.5", () => {
  const a = Activations.find("LOGISTIC") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0.5, 1e-10);
});

Deno.test("ReLU: squash(0) = 0", () => {
  const a = Activations.find("ReLU") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("ReLU6: squash(0) = 0", () => {
  const a = Activations.find("ReLU6") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("SINE: squash(0) = 0", () => {
  const a = Activations.find("SINE") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("TANH: squash(0) = 0", () => {
  const a = Activations.find("TANH") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("STEP: squash(0) = 0", () => {
  const a = Activations.find("STEP") as unknown as ActivationInterface;
  assertEquals(a.squash(0), 0);
});

Deno.test("BIPOLAR: squash(0) = -1", () => {
  const a = Activations.find("BIPOLAR") as unknown as ActivationInterface;
  assertEquals(a.squash(0), -1);
});

Deno.test("ABSOLUTE: squash(0) = 0", () => {
  const a = Activations.find("ABSOLUTE") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("SQUARE: squash(0) = 0", () => {
  const a = Activations.find("SQUARE") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("SQRT: squash(0) = 0", () => {
  const a = Activations.find("SQRT") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("Softplus: squash(0) ≈ ln(2)", () => {
  const a = Activations.find("Softplus") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), Math.log(2), 1e-6);
});

Deno.test("SOFTSIGN: squash(0) = 0", () => {
  const a = Activations.find("SOFTSIGN") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("Swish: squash(0) = 0", () => {
  const a = Activations.find("Swish") as unknown as ActivationInterface;
  // Swish(0) = 0 * sigmoid(0) = 0 * 0.5 = 0
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("GELU: squash(0) = 0", () => {
  const a = Activations.find("GELU") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-6);
});

Deno.test("Mish: squash(0) ≈ 0", () => {
  const a = Activations.find("Mish") as unknown as ActivationInterface;
  // Mish(0) = 0 * tanh(ln(2)) ≈ 0
  assertAlmostEquals(a.squash(0), 0, 1e-6);
});

Deno.test("LeakyReLU: squash(0) = 0", () => {
  const a = Activations.find("LeakyReLU") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("ISRU: squash(0) = 0", () => {
  const a = Activations.find("ISRU") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("SELU: squash(0) = 0", () => {
  const a = Activations.find("SELU") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("StdInverse: squash(0) produces large magnitude (1/x near zero)", () => {
  const a = Activations.find("StdInverse") as unknown as ActivationInterface;
  // StdInverse is 1/x; near 0 it produces very large magnitude values
  const result = a.squash(0);
  assert(
    Number.isFinite(result),
    `StdInverse: squash(0) should be finite, got ${result}`,
  );
  assert(
    Math.abs(result) > 1e10,
    `StdInverse: squash(0) should be very large magnitude, got ${result}`,
  );
});

Deno.test("TAN: squash(0) = 0", () => {
  const a = Activations.find("TAN") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("BIPOLAR_SIGMOID: squash(0) = 0", () => {
  const a = Activations.find(
    "BIPOLAR_SIGMOID",
  ) as unknown as ActivationInterface;
  // 2 * sigmoid(0) - 1 = 2 * 0.5 - 1 = 0
  assertAlmostEquals(a.squash(0), 0, 1e-10);
});

Deno.test("LogSigmoid: squash(0) = -ln(2)", () => {
  const a = Activations.find("LogSigmoid") as unknown as ActivationInterface;
  assertAlmostEquals(a.squash(0), -Math.log(2), 1e-6);
});

// --- Non-finite input handling ---

/** Activations that should produce a finite result for non-finite inputs. */
const ACTIVATIONS_HANDLING_NON_FINITE: string[] = [
  "LOGISTIC",
  "ReLU",
  "ReLU6",
  "TANH",
  "STEP",
  "GAUSSIAN",
  "Exponential",
  "SQUARE",
];

for (const name of ACTIVATIONS_HANDLING_NON_FINITE) {
  Deno.test(`${name}: squash handles non-finite inputs gracefully`, () => {
    const activation = Activations.find(name) as unknown as ActivationInterface;

    for (const x of [NaN, Infinity, -Infinity]) {
      const result = activation.squash(x);
      assert(
        Number.isFinite(result),
        `${name}: squash(${x}) = ${result}, expected finite`,
      );
    }
  });
}

// --- Large positive inputs ---

Deno.test("LOGISTIC: squash(large) ≈ 1", () => {
  const a = Activations.find("LOGISTIC") as unknown as ActivationInterface;
  const result = a.squash(100);
  assert(result > 0.99 && result <= 1, `LOGISTIC(100) = ${result}`);
});

Deno.test("TANH: squash(large) ≈ 1", () => {
  const a = Activations.find("TANH") as unknown as ActivationInterface;
  const result = a.squash(100);
  assert(result > 0.99 && result <= 1, `TANH(100) = ${result}`);
});

Deno.test("ArcTan: squash(large) ≈ π/2", () => {
  const a = Activations.find("ArcTan") as unknown as ActivationInterface;
  const result = a.squash(1000);
  assertAlmostEquals(result, Math.PI / 2, 0.01);
});

Deno.test("ReLU: squash(large) = large", () => {
  const a = Activations.find("ReLU") as unknown as ActivationInterface;
  assertEquals(a.squash(1000), 1000);
});

Deno.test("HARD_TANH: squash(large) = 1", () => {
  const a = Activations.find("HARD_TANH") as unknown as ActivationInterface;
  assertEquals(a.squash(100), 1);
});

Deno.test("GAUSSIAN: squash(large) ≈ 0", () => {
  const a = Activations.find("GAUSSIAN") as unknown as ActivationInterface;
  const result = a.squash(100);
  assertAlmostEquals(result, 0, 1e-6);
});

// --- Large negative inputs ---

Deno.test("LOGISTIC: squash(large_negative) ≈ 0", () => {
  const a = Activations.find("LOGISTIC") as unknown as ActivationInterface;
  const result = a.squash(-100);
  assert(result >= 0 && result < 0.01, `LOGISTIC(-100) = ${result}`);
});

Deno.test("TANH: squash(large_negative) ≈ -1", () => {
  const a = Activations.find("TANH") as unknown as ActivationInterface;
  const result = a.squash(-100);
  assert(result >= -1 && result < -0.99, `TANH(-100) = ${result}`);
});

Deno.test("ArcTan: squash(large_negative) ≈ -π/2", () => {
  const a = Activations.find("ArcTan") as unknown as ActivationInterface;
  const result = a.squash(-1000);
  assertAlmostEquals(result, -Math.PI / 2, 0.01);
});

Deno.test("ReLU: squash(negative) = 0", () => {
  const a = Activations.find("ReLU") as unknown as ActivationInterface;
  assertEquals(a.squash(-100), 0);
});

Deno.test("HARD_TANH: squash(large_negative) = -1", () => {
  const a = Activations.find("HARD_TANH") as unknown as ActivationInterface;
  assertEquals(a.squash(-100), -1);
});

// --- Specific boundary values ---

Deno.test("HARD_TANH: boundary at ±1", () => {
  const a = Activations.find("HARD_TANH") as unknown as ActivationInterface;
  assertEquals(a.squash(1), 1);
  assertEquals(a.squash(-1), -1);
  // Just inside linear range
  assertAlmostEquals(a.squash(0.99), 0.99, 1e-10);
  assertAlmostEquals(a.squash(-0.99), -0.99, 1e-10);
});

Deno.test("ReLU6: boundary at 0 and 6", () => {
  const a = Activations.find("ReLU6") as unknown as ActivationInterface;
  assertEquals(a.squash(0), 0);
  assertEquals(a.squash(6), 6);
  assertEquals(a.squash(-1), 0);
  assertEquals(a.squash(7), 6);
});

Deno.test("BIPOLAR: boundary at 0", () => {
  const a = Activations.find("BIPOLAR") as unknown as ActivationInterface;
  assertEquals(a.squash(0), -1);
  assertEquals(a.squash(0.001), 1);
  assertEquals(a.squash(-0.001), -1);
});

Deno.test("STEP: boundary at 0", () => {
  const a = Activations.find("STEP") as unknown as ActivationInterface;
  assertEquals(a.squash(0), 0);
  assertEquals(a.squash(0.001), 1);
  assertEquals(a.squash(-0.001), 0);
});

Deno.test("SOFTSIGN: asymptotic approach to ±0.99 (clamped range)", () => {
  const a = Activations.find("SOFTSIGN") as unknown as ActivationInterface;
  const large = a.squash(1000);
  const smallNeg = a.squash(-1000);
  // SOFTSIGN range is clamped at ±0.99
  assertAlmostEquals(large, 0.99, 0.01);
  assertAlmostEquals(smallNeg, -0.99, 0.01);
});

// --- getName() returns correct name ---

const NAME_MAP: Record<string, string> = {
  "ArcTan": "ArcTan",
  "BENT_IDENTITY": "BENT_IDENTITY",
  "BIPOLAR": "BIPOLAR",
  "BIPOLAR_SIGMOID": "BIPOLAR_SIGMOID",
  "COMPLEMENT": "COMPLEMENT",
  "Cosine": "Cosine",
  "Cube": "Cube",
  "ELU": "ELU",
  "Exponential": "Exponential",
  "GAUSSIAN": "GAUSSIAN",
  "GELU": "GELU",
  "HARD_TANH": "HARD_TANH",
  "IDENTITY": "IDENTITY",
  "ISRU": "ISRU",
  "LeakyReLU": "LeakyReLU",
  "LOGISTIC": "LOGISTIC",
  "LogSigmoid": "LogSigmoid",
  "Mish": "Mish",
  "ReLU": "ReLU",
  "ReLU6": "ReLU6",
  "SELU": "SELU",
  "SINE": "SINE",
  "Softplus": "Softplus",
  "SOFTSIGN": "SOFTSIGN",
  "SQRT": "SQRT",
  "SQUARE": "SQUARE",
  "StdInverse": "StdInverse",
  "STEP": "STEP",
  "Swish": "Swish",
  "TAN": "TAN",
  "TANH": "TANH",
  "ABSOLUTE": "ABSOLUTE",
};

for (const [lookupName, expectedName] of Object.entries(NAME_MAP)) {
  Deno.test(`${lookupName}: getName() returns "${expectedName}"`, () => {
    const activation = Activations.find(lookupName);
    assertEquals(activation.getName(), expectedName);
  });
}
