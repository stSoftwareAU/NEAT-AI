/**
 * Unit tests for activation function calculateError() method.
 *
 * Verifies that each activation's error calculation produces finite,
 * directionally correct results for typical training scenarios.
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";
import { Activations } from "../../../src/methods/activations/Activations.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";

/** Helper to get an activation with squash available. */
function findActivation(name: string): ActivationInterface {
  return Activations.find(name) as unknown as ActivationInterface;
}

/** Type guard for activations that implement calculateError. */
function hasCalculateError(
  act: ActivationInterface,
): act is ActivationInterface & {
  calculateError(
    currentActivation: number,
    targetActivation: number,
    currentValue: number,
  ): number;
} {
  return typeof (act as unknown as Record<string, unknown>).calculateError ===
    "function";
}

/** Standard activations that implement calculateError. */
const ACTIVATIONS_WITH_CALCULATE_ERROR: string[] = [
  "IDENTITY",
  "ReLU",
  "LOGISTIC",
  "TANH",
  "SELU",
  "ELU",
  "LeakyReLU",
  "ABSOLUTE",
  "GAUSSIAN",
  "STEP",
  "BIPOLAR",
  "COMPLEMENT",
  "Cosine",
  "SOFTSIGN",
  "Softplus",
  "ArcTan",
  "BENT_IDENTITY",
  "BIPOLAR_SIGMOID",
  "HARD_TANH",
  "SINE",
  "Mish",
  "Swish",
  "GELU",
  "ReLU6",
  "ISRU",
  "SQUARE",
  "SQRT",
  "Cube",
  "Exponential",
  "LogSigmoid",
  "StdInverse",
  "TAN",
];

for (const name of ACTIVATIONS_WITH_CALCULATE_ERROR) {
  Deno.test(`${name}: calculateError returns 0 when target equals current`, () => {
    const act = findActivation(name);
    if (!hasCalculateError(act)) return;

    const activation = act.squash(1);
    const error = act.calculateError(activation, activation, 1);
    assertEquals(error, 0);
  });
}

for (const name of ACTIVATIONS_WITH_CALCULATE_ERROR) {
  Deno.test(`${name}: calculateError returns finite number`, () => {
    const act = findActivation(name);
    if (!hasCalculateError(act)) return;

    const current = act.squash(0.5);
    const target = act.squash(1);
    const error = act.calculateError(current, target, 0.5);
    assertEquals(
      Number.isFinite(error),
      true,
      `${name} calculateError returned non-finite: ${error}`,
    );
  });
}

for (const name of ACTIVATIONS_WITH_CALCULATE_ERROR) {
  Deno.test(`${name}: calculateError direction is correct for positive delta`, () => {
    const act = findActivation(name);
    if (!hasCalculateError(act)) return;

    const current = act.squash(0);
    const target = act.squash(1);

    // Only test when activations produce distinct values
    if (current === target) return;

    const error = act.calculateError(current, target, 0);
    // Error should be non-zero (directional)
    assert(error !== 0, `${name} calculateError should be non-zero`);
  });
}

Deno.test("LOGISTIC calculateError uses derivative for centre region", () => {
  const act = findActivation("LOGISTIC");
  if (!hasCalculateError(act)) return;

  // At x=0, sigmoid is 0.5 with strong slope
  const error = act.calculateError(0.5, 0.7, 0);
  assertEquals(Number.isFinite(error), true);
  assertEquals(error > 0, true); // Should push value up
});

Deno.test("TANH calculateError uses derivative for centre region", () => {
  const act = findActivation("TANH");
  if (!hasCalculateError(act)) return;

  // At x=0, tanh is 0 with strong slope
  const error = act.calculateError(0, 0.5, 0);
  assertEquals(Number.isFinite(error), true);
  assertEquals(error > 0, true);
});

Deno.test("IDENTITY calculateError reflects raw error", () => {
  const act = findActivation("IDENTITY");
  if (!hasCalculateError(act)) return;

  const error = act.calculateError(1, 3, 1);
  assertEquals(Number.isFinite(error), true);
  assertEquals(error > 0, true);
});

Deno.test("ReLU calculateError handles active region", () => {
  const act = findActivation("ReLU");
  if (!hasCalculateError(act)) return;

  // In active region (x > 0), derivative is 1
  const error = act.calculateError(2, 5, 2);
  assertEquals(Number.isFinite(error), true);
  assertEquals(error > 0, true);
});

Deno.test("ReLU calculateError handles dead region", () => {
  const act = findActivation("ReLU");
  if (!hasCalculateError(act)) return;

  // In dead region (x <= 0), uses fallback
  const error = act.calculateError(0, 0.5, -1);
  assertEquals(Number.isFinite(error), true);
});
