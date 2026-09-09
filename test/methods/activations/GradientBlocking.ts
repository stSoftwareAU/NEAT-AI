/**
 * Tests for GradientBlocking.ts
 *
 * Issue #3974 — an activation is gradient-blocking when it kills the gradient
 * over a *region* of its input space, which inside a serial chain zeroes the
 * gradient for every member upstream of it. The classification is measured
 * from each activation's own `derivative()`, so these tests assert the measured
 * outcome and guard against a new activation joining the registry unclassified.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { Activations } from "@methods/activations/Activations.ts";
import { ActivationError } from "@errors/ActivationError.ts";
import {
  DEAD_FRACTION_THRESHOLD,
  DEAD_SAMPLE_GRID,
  GRADIENT_GATING_SQUASHES,
  gradientDeadFraction,
  isGradientBlockingSquash,
} from "@methods/activations/GradientBlocking.ts";

Deno.test("GradientBlocking - HARD_TANH is dead on both tails and is blocking", () => {
  const fraction = gradientDeadFraction("HARD_TANH");
  assert(fraction !== undefined);
  // Dead outside (-1, 1): 14 of the 16 units of the [-8, 8] grid.
  assertAlmostEquals(fraction, 0.875, 1e-9);
  assertEquals(isGradientBlockingSquash("HARD_TANH"), true);
});

Deno.test("GradientBlocking - STEP is dead everywhere and is blocking", () => {
  assertEquals(gradientDeadFraction("STEP"), 1);
  assertEquals(isGradientBlockingSquash("STEP"), true);
});

Deno.test("GradientBlocking - the gating aggregates are blocking by construction", () => {
  for (const name of GRADIENT_GATING_SQUASHES) {
    assertEquals(
      gradientDeadFraction(name),
      undefined,
      `${name} should expose no scalar derivative`,
    );
    assertEquals(
      isGradientBlockingSquash(name),
      true,
      `${name} gates the gradient onto one branch`,
    );
  }
});

Deno.test("GradientBlocking - the well-behaved pool is not blocking", () => {
  for (const name of ["IDENTITY", "TANH", "ReLU", "LeakyReLU", "GELU"]) {
    assertEquals(
      isGradientBlockingSquash(name),
      false,
      `${name} is named in Issue #3974 as well behaved`,
    );
  }
  // ReLU sits on the boundary deliberately: dead on exactly half the grid,
  // and the threshold is strict.
  assertEquals(gradientDeadFraction("ReLU"), DEAD_FRACTION_THRESHOLD);
});

Deno.test("GradientBlocking - aliases resolve to the canonical classification", () => {
  assertEquals(
    isGradientBlockingSquash("RELU"),
    isGradientBlockingSquash("ReLU"),
  );
});

Deno.test("GradientBlocking - an unknown activation fails loud", () => {
  assertThrows(
    () => isGradientBlockingSquash("NOT_AN_ACTIVATION"),
    ActivationError,
  );
});

Deno.test("GradientBlocking - the grid is symmetric and never samples zero", () => {
  assertEquals(DEAD_SAMPLE_GRID.length, 160);
  for (const x of DEAD_SAMPLE_GRID) assert(x !== 0);
  const sum = DEAD_SAMPLE_GRID.reduce((a, b) => a + b, 0);
  assertAlmostEquals(sum, 0, 1e-9);
});

Deno.test("GradientBlocking - classifying any registered activation never throws", () => {
  // `ModSquash` calls this on every proposal under a live bias, so a
  // derivative that throws on part of the grid would take an evolution run
  // down with it.
  for (const activation of Activations.list()) {
    const name = activation.getName();
    isGradientBlockingSquash(name);
    const fraction = gradientDeadFraction(name);
    if (fraction !== undefined) {
      assert(
        fraction >= 0 && fraction <= 1,
        `${name} reported a dead fraction outside [0, 1]: ${fraction}`,
      );
    }
  }
});

Deno.test("GradientBlocking - every selectable activation is classified", () => {
  // Drift guard: an activation mutation can select must either expose a scalar
  // derivative (measured classification) or be a recorded gating aggregate.
  // A new aggregate joining the registry fails here rather than being silently
  // treated as gradient-safe.
  for (const activation of Activations.list()) {
    if (activation.mutationProbability <= 0) continue;
    const name = activation.getName();
    if (typeof activation.derivative === "function") continue;
    assert(
      GRADIENT_GATING_SQUASHES.has(name),
      `${name} has no derivative and is not recorded in GRADIENT_GATING_SQUASHES`,
    );
  }
});
