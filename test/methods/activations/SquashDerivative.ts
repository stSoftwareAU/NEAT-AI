/**
 * Unit tests for individual activation function squash() and derivative()
 * methods, verifying mathematical correctness of each implementation.
 *
 * @module
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

/** Helper to get an activation with squash/derivative available. */
function findActivation(name: string): ActivationInterface {
  return Activations.find(name) as unknown as ActivationInterface;
}

// --- IDENTITY ---
Deno.test("IDENTITY squash returns input unchanged", () => {
  const act = findActivation("IDENTITY");
  assertEquals(act.squash(0), 0);
  assertEquals(act.squash(1), 1);
  assertEquals(act.squash(-5), -5);
  assertEquals(act.squash(100), 100);
});

Deno.test("IDENTITY derivative is always 1", () => {
  const act = findActivation("IDENTITY");
  assertEquals(act.derivative!(0), 1);
  assertEquals(act.derivative!(100), 1);
  assertEquals(act.derivative!(-50), 1);
});

// --- ReLU ---
Deno.test("ReLU squash clips negative values to zero", () => {
  const act = findActivation("ReLU");
  assertEquals(act.squash(5), 5);
  assertEquals(act.squash(0), 0);
  assertEquals(act.squash(-3), 0);
});

Deno.test("ReLU derivative is 1 for positive, 0 for negative", () => {
  const act = findActivation("ReLU");
  assertEquals(act.derivative!(5), 1);
  assertEquals(act.derivative!(-3), 0);
});

// --- ABSOLUTE ---
Deno.test("ABSOLUTE squash returns absolute value", () => {
  const act = findActivation("ABSOLUTE");
  assertEquals(act.squash(3), 3);
  assertEquals(act.squash(-3), 3);
  assertEquals(act.squash(0), 0);
});

Deno.test("ABSOLUTE derivative is sign function", () => {
  const act = findActivation("ABSOLUTE");
  assertEquals(act.derivative!(5), 1);
  assertEquals(act.derivative!(-5), -1);
  assertEquals(act.derivative!(0), 0);
});

// --- STEP ---
Deno.test("STEP squash returns 1 for positive, 0 for non-positive", () => {
  const act = findActivation("STEP");
  assertEquals(act.squash(1), 1);
  assertEquals(act.squash(0), 0);
  assertEquals(act.squash(-1), 0);
});

Deno.test("STEP derivative is pseudo-gradient near threshold", () => {
  const act = findActivation("STEP");
  // Near zero: small pseudo-gradient
  assertAlmostEquals(act.derivative!(0.005), 0.01, 0.001);
  // Away from zero: zero gradient
  assertEquals(act.derivative!(1), 0);
  assertEquals(act.derivative!(-1), 0);
});

// --- LOGISTIC (Sigmoid) ---
Deno.test("LOGISTIC squash returns 0.5 at x=0", () => {
  const act = findActivation("LOGISTIC");
  assertAlmostEquals(act.squash(0), 0.5, 1e-10);
});

Deno.test("LOGISTIC squash is bounded in (0, 1)", () => {
  const act = findActivation("LOGISTIC");
  const high = act.squash(100);
  const low = act.squash(-100);
  assertEquals(high <= 1, true);
  assertEquals(high > 0.99, true);
  assertEquals(low >= 0, true);
  assertEquals(low < 0.01, true);
});

Deno.test("LOGISTIC derivative peaks at x=0", () => {
  const act = findActivation("LOGISTIC");
  // f'(0) = 0.5 * 0.5 = 0.25
  assertAlmostEquals(act.derivative!(0), 0.25, 1e-10);
  // Derivative should be smaller away from zero
  assertEquals(act.derivative!(5) < 0.25, true);
  assertEquals(act.derivative!(-5) < 0.25, true);
});

// --- TANH ---
Deno.test("TANH squash returns 0 at x=0", () => {
  const act = findActivation("TANH");
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

Deno.test("TANH squash is bounded in (-1, 1)", () => {
  const act = findActivation("TANH");
  const high = act.squash(100);
  const low = act.squash(-100);
  assertEquals(high <= 1, true);
  assertEquals(high > 0.99, true);
  assertEquals(low >= -1, true);
  assertEquals(low < -0.99, true);
});

Deno.test("TANH derivative peaks at x=0", () => {
  const act = findActivation("TANH");
  // f'(0) = 1 - tanh(0)^2 = 1
  assertAlmostEquals(act.derivative!(0), 1, 1e-10);
  assertEquals(act.derivative!(5) < 1, true);
});

// --- GAUSSIAN ---
Deno.test("GAUSSIAN squash peaks at x=0", () => {
  const act = findActivation("GAUSSIAN");
  assertAlmostEquals(act.squash(0), 1, 1e-10);
});

Deno.test("GAUSSIAN squash decays toward 0 for large |x|", () => {
  const act = findActivation("GAUSSIAN");
  assertEquals(act.squash(5) < 0.01, true);
  assertEquals(act.squash(-5) < 0.01, true);
  assertEquals(act.squash(5) >= 0, true);
});

Deno.test("GAUSSIAN derivative is 0 at x=0", () => {
  const act = findActivation("GAUSSIAN");
  // f'(0) = -2 * 0 * exp(0) = 0
  assertAlmostEquals(act.derivative!(0), 0, 1e-10);
});

Deno.test("GAUSSIAN derivative is negative for positive x", () => {
  const act = findActivation("GAUSSIAN");
  assertEquals(act.derivative!(1) < 0, true);
});

// --- SELU ---
Deno.test("SELU squash is linear for positive x", () => {
  const act = findActivation("SELU");
  const scale = 1.0507009873554804934193349852946;
  assertAlmostEquals(act.squash(1), scale, 1e-10);
  assertAlmostEquals(act.squash(2), 2 * scale, 1e-10);
});

Deno.test("SELU squash returns 0 at x=0", () => {
  const act = findActivation("SELU");
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

Deno.test("SELU squash is negative for negative x", () => {
  const act = findActivation("SELU");
  assertEquals(act.squash(-1) < 0, true);
  assertEquals(act.squash(-10) < 0, true);
});

Deno.test("SELU derivative equals scale for positive x", () => {
  const act = findActivation("SELU");
  const scale = 1.0507009873554804934193349852946;
  assertAlmostEquals(act.derivative!(1), scale, 1e-10);
  assertAlmostEquals(act.derivative!(10), scale, 1e-10);
});

// --- ELU ---
Deno.test("ELU squash is linear for positive x", () => {
  const act = findActivation("ELU");
  assertEquals(act.squash(0), 0);
  assertEquals(act.squash(5), 5);
});

Deno.test("ELU squash approaches -1 for large negative x", () => {
  const act = findActivation("ELU");
  const val = act.squash(-100);
  assertAlmostEquals(val, -1, 0.01);
});

// --- LeakyReLU ---
Deno.test("LeakyReLU squash passes positive values through", () => {
  const act = findActivation("LeakyReLU");
  assertEquals(act.squash(5), 5);
});

Deno.test("LeakyReLU squash applies small slope to negative values", () => {
  const act = findActivation("LeakyReLU");
  const val = act.squash(-10);
  assertEquals(val < 0, true);
  // Leaky slope should make it much smaller in magnitude than input
  assertEquals(Math.abs(val) < 10, true);
});

// --- BIPOLAR ---
Deno.test("BIPOLAR squash returns 1 for positive, -1 for non-positive", () => {
  const act = findActivation("BIPOLAR");
  assertEquals(act.squash(1), 1);
  assertEquals(act.squash(-1), -1);
  assertEquals(act.squash(0), -1);
});

// --- COMPLEMENT ---
Deno.test("COMPLEMENT squash returns 1 - x", () => {
  const act = findActivation("COMPLEMENT");
  assertEquals(act.squash(0), 1);
  assertEquals(act.squash(1), 0);
  assertAlmostEquals(act.squash(0.3), 0.7, 1e-10);
});

Deno.test("COMPLEMENT derivative is always -1", () => {
  const act = findActivation("COMPLEMENT");
  assertEquals(act.derivative!(0), -1);
  assertEquals(act.derivative!(5), -1);
});

// --- Cosine ---
Deno.test("Cosine squash returns cos(x)", () => {
  const act = findActivation("Cosine");
  assertAlmostEquals(act.squash(0), 1, 1e-10);
  assertAlmostEquals(act.squash(Math.PI), -1, 1e-10);
});

// --- SOFTSIGN ---
Deno.test("SOFTSIGN squash returns x/(1+|x|)", () => {
  const act = findActivation("SOFTSIGN");
  assertEquals(act.squash(0), 0);
  assertAlmostEquals(act.squash(1), 0.5, 1e-10);
  assertAlmostEquals(act.squash(-1), -0.5, 1e-10);
});

Deno.test("SOFTSIGN squash is bounded in (-1, 1)", () => {
  const act = findActivation("SOFTSIGN");
  assertEquals(act.squash(1000) < 1, true);
  assertEquals(act.squash(-1000) > -1, true);
});

// --- Softplus ---
Deno.test("Softplus squash returns ln(1+exp(x))", () => {
  const act = findActivation("Softplus");
  assertAlmostEquals(act.squash(0), Math.log(2), 1e-10);
  assertEquals(act.squash(0) > 0, true);
});

Deno.test("Softplus squash is always positive", () => {
  const act = findActivation("Softplus");
  assertEquals(act.squash(-10) > 0, true);
  assertEquals(act.squash(10) > 0, true);
});

// --- BENT_IDENTITY ---
Deno.test("BENT_IDENTITY squash at x=0 returns 0", () => {
  const act = findActivation("BENT_IDENTITY");
  // f(0) = (sqrt(0+1) - 1)/2 + 0 = 0
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

// --- ArcTan ---
Deno.test("ArcTan squash returns atan(x)", () => {
  const act = findActivation("ArcTan");
  assertAlmostEquals(act.squash(0), 0, 1e-10);
  assertAlmostEquals(act.squash(1), Math.atan(1), 1e-10);
});

// --- BIPOLAR_SIGMOID ---
Deno.test("BIPOLAR_SIGMOID squash returns 0 at x=0", () => {
  const act = findActivation("BIPOLAR_SIGMOID");
  // 2/(1+exp(0)) - 1 = 2/2 - 1 = 0
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

// --- HARD_TANH / CLIPPED ---
Deno.test("HARD_TANH squash clips to [-1, 1]", () => {
  const act = findActivation("HARD_TANH");
  assertEquals(act.squash(0.5), 0.5);
  assertEquals(act.squash(2), 1);
  assertEquals(act.squash(-2), -1);
});

Deno.test("HARD_TANH alias CLIPPED works", () => {
  const act = findActivation("CLIPPED");
  assertEquals(act.getName(), "HARD_TANH");
});

// --- SINE ---
Deno.test("SINE squash returns sin(x)", () => {
  const act = findActivation("SINE");
  assertAlmostEquals(act.squash(0), 0, 1e-10);
  assertAlmostEquals(act.squash(Math.PI / 2), 1, 1e-10);
});

Deno.test("SINE alias SINUSOID works", () => {
  const act = findActivation("SINUSOID");
  assertEquals(act.getName(), "SINE");
});

// --- Mish ---
Deno.test("Mish squash returns 0 at x=0", () => {
  const act = findActivation("Mish");
  // Mish(0) = 0 * tanh(ln(2)) ≈ 0
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

Deno.test("Mish squash approaches x for large positive x", () => {
  const act = findActivation("Mish");
  const val = act.squash(10);
  // For large x, Mish(x) ≈ x
  assertAlmostEquals(val, 10, 0.01);
});

// --- Swish ---
Deno.test("Swish squash returns 0 at x=0", () => {
  const act = findActivation("Swish");
  // Swish(0) = 0 * sigmoid(0) = 0
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

// --- GELU ---
Deno.test("GELU squash returns 0 at x=0", () => {
  const act = findActivation("GELU");
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

Deno.test("GELU squash approaches x for large positive x", () => {
  const act = findActivation("GELU");
  assertAlmostEquals(act.squash(10), 10, 0.01);
});

// --- ReLU6 ---
Deno.test("ReLU6 squash clips to [0, 6]", () => {
  const act = findActivation("ReLU6");
  assertEquals(act.squash(-1), 0);
  assertEquals(act.squash(3), 3);
  assertEquals(act.squash(10), 6);
});

// --- ISRU ---
Deno.test("ISRU squash returns 0 at x=0", () => {
  const act = findActivation("ISRU");
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

// --- SQUARE ---
Deno.test("SQUARE squash returns x*x", () => {
  const act = findActivation("SQUARE");
  assertEquals(act.squash(3), 9);
  assertEquals(act.squash(-3), 9);
  assertEquals(act.squash(0), 0);
});

// --- SQRT ---
Deno.test("SQRT squash returns sqrt(|x|) with sign", () => {
  const act = findActivation("SQRT");
  assertAlmostEquals(act.squash(4), 2, 1e-10);
  assertEquals(act.squash(0), 0);
});

// --- Cube ---
Deno.test("Cube squash returns x^3", () => {
  const act = findActivation("Cube");
  assertEquals(act.squash(2), 8);
  assertEquals(act.squash(-2), -8);
  assertEquals(act.squash(0), 0);
});

// --- Exponential ---
Deno.test("Exponential squash returns exp(x)", () => {
  const act = findActivation("Exponential");
  assertAlmostEquals(act.squash(0), 1, 1e-10);
  assertAlmostEquals(act.squash(1), Math.E, 1e-10);
});

// --- LogSigmoid ---
Deno.test("LogSigmoid squash is negative for all x", () => {
  const act = findActivation("LogSigmoid");
  assertEquals(act.squash(0) < 0, true);
  assertEquals(act.squash(10) < 0, true);
  assertEquals(act.squash(-10) < 0, true);
});

// --- TAN ---
Deno.test("TAN squash returns tan(x) at small values", () => {
  const act = findActivation("TAN");
  assertAlmostEquals(act.squash(0), 0, 1e-10);
});

// --- StdInverse ---
Deno.test("StdInverse squash returns 1/x for non-zero x", () => {
  const act = findActivation("StdInverse");
  assertAlmostEquals(act.squash(2), 0.5, 1e-10);
  assertAlmostEquals(act.squash(0.5), 2, 1e-10);
  assertAlmostEquals(act.squash(-1), -1, 1e-10);
});
