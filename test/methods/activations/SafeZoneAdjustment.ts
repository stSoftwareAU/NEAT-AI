/**
 * Unit tests for activation function safeZoneAdjustment() implementations.
 *
 * These tests verify that safe-zone factors behave correctly:
 * - Return values are always in [0, 1]
 * - Return 0 for non-finite inputs
 * - Return high values (near 1) in the linear/active region
 * - Return low values (near 0) in saturation regions
 * - Recovery logic allows small values when error direction would help
 *
 * The per-activation scenarios are table-driven (Issue #3677): the
 * `Activations.find(...)` + `hasSafeZone` guard is lifted into one helper and
 * each former test body is a row of `[activation, scenario, cases]`, still
 * reported per scenario as its own named test.
 *
 * @module
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Activations } from "@methods/activations/Activations.ts";
import type { AbstractActivationInterface } from "@methods/activations/AbstractActivationInterface.ts";

type SafeZoneActivation = AbstractActivationInterface & {
  safeZoneAdjustment(
    rawInput: number,
    error: number,
    weight: number,
  ): number;
};

function hasSafeZone(
  activation: AbstractActivationInterface,
): activation is SafeZoneActivation {
  return typeof activation.safeZoneAdjustment === "function";
}

/** Resolve an activation, failing loud when it has no safe-zone logic. */
function findSafeZoneActivation(name: string): SafeZoneActivation {
  const activation = Activations.find(name);
  assert(hasSafeZone(activation), `${name} must have safeZoneAdjustment`);
  return activation;
}

/** One `safeZoneAdjustment(rawInput, error, weight)` expectation. */
type SafeZoneCase = {
  readonly rawInput: number;
  readonly error: number;
  /** Incoming synapse weight; defaults to 1. */
  readonly weight?: number;
  readonly expected: number;
  /** Omit for an exact match. */
  readonly tolerance?: number;
};

/** A named scenario for one activation. */
type SafeZoneScenario = {
  readonly name: string;
  readonly scenario: string;
  readonly cases: readonly SafeZoneCase[];
};

function assertSafeZoneCase(
  activation: SafeZoneActivation,
  name: string,
  safeZoneCase: SafeZoneCase,
): void {
  const weight = safeZoneCase.weight ?? 1;
  const result = activation.safeZoneAdjustment(
    safeZoneCase.rawInput,
    safeZoneCase.error,
    weight,
  );
  const label =
    `${name}.safeZoneAdjustment(${safeZoneCase.rawInput}, ${safeZoneCase.error}, ${weight})`;

  if (safeZoneCase.tolerance === undefined) {
    assertEquals(result, safeZoneCase.expected, label);
  } else {
    assertAlmostEquals(
      result,
      safeZoneCase.expected,
      safeZoneCase.tolerance,
      label,
    );
  }
}

// --- Specific safe-zone boundary tests for key activations ---

const SAFE_ZONE_SCENARIOS: readonly SafeZoneScenario[] = [
  {
    name: "ArcTan",
    scenario: "full confidence in linear zone [-2, 2]",
    cases: [
      { rawInput: 0, error: 0.1, expected: 1 },
      { rawInput: 1, error: 0.1, expected: 1 },
      { rawInput: -2, error: 0.1, expected: 1 },
      { rawInput: 2, error: -0.1, expected: 1 },
    ],
  },
  {
    name: "ArcTan",
    scenario: "zero confidence beyond saturation zone (|x| > 4)",
    cases: [
      { rawInput: 5, error: 0.1, expected: 0 },
      { rawInput: -5, error: -0.1, expected: 0 },
    ],
  },
  {
    name: "ArcTan",
    scenario: "recovery zone allows small values",
    cases: [
      // rawInput > 2 and error < 0 (pushing toward centre)
      { rawInput: 3, error: -0.1, expected: 0.3, tolerance: 0.01 },
      // rawInput < -2 and error > 0 (pushing toward centre)
      { rawInput: -3, error: 0.1, expected: 0.3, tolerance: 0.01 },
    ],
  },
  {
    name: "LOGISTIC",
    scenario: "full confidence in safe zone [-6, 6]",
    cases: [
      { rawInput: 0, error: 0.1, expected: 1 },
      { rawInput: 5, error: 0.1, expected: 1 },
      { rawInput: -6, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "LOGISTIC",
    scenario: "zero confidence beyond hard saturation",
    cases: [
      { rawInput: 11, error: 0.1, expected: 0 },
      { rawInput: -11, error: -0.1, expected: 0 },
    ],
  },
  {
    name: "LOGISTIC",
    scenario: "recovery allows small propagation",
    cases: [
      // rawInput < -6 and error > 0 → recovery
      { rawInput: -8, error: 0.1, expected: 0.2, tolerance: 0.01 },
      // rawInput > 6 and error < 0 → recovery
      { rawInput: 8, error: -0.1, expected: 0.2, tolerance: 0.01 },
    ],
  },
  {
    name: "TANH",
    scenario: "full confidence in safe zone [-2, 2]",
    cases: [
      { rawInput: 0, error: 0.1, expected: 1 },
      { rawInput: 1.5, error: 0.1, expected: 1 },
      { rawInput: -2, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "TANH",
    scenario: "zero confidence beyond saturation",
    cases: [
      { rawInput: 7, error: 0.1, expected: 0 },
      { rawInput: -7, error: -0.1, expected: 0 },
    ],
  },
  {
    name: "TANH",
    scenario: "fade zone between safe and saturation",
    cases: [
      // rawInput = 4, between safe (2) and max (6)
      // fade = 1 - (4 - 2) / (6 - 2) = 0.5
      { rawInput: 4, error: 0.1, expected: 0.5, tolerance: 0.01 },
    ],
  },
  {
    name: "HARD_TANH",
    scenario: "full confidence in linear zone [-0.9, 0.9]",
    cases: [
      { rawInput: 0, error: 0.1, expected: 1 },
      { rawInput: 0.5, error: 0.1, expected: 1 },
      { rawInput: -0.9, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "HARD_TANH",
    scenario: "zero confidence far outside clipping zone",
    cases: [
      { rawInput: 2, error: 0.1, expected: 0 },
      { rawInput: -2, error: -0.1, expected: 0 },
    ],
  },
  {
    name: "ReLU",
    scenario: "full confidence when active (x > 0)",
    cases: [
      { rawInput: 1, error: 0.1, expected: 1 },
      { rawInput: 100, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "ReLU",
    scenario: "dead zone when x <= 0 and error <= 0",
    cases: [
      { rawInput: -1, error: -0.1, expected: 0 },
      { rawInput: 0, error: -0.1, expected: 0 },
    ],
  },
  {
    name: "ReLU",
    scenario: "recovery when x <= 0 and error > 0",
    cases: [
      { rawInput: -1, error: 0.1, expected: 1 },
      { rawInput: 0, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "ReLU6",
    scenario: "full confidence in active zone (0, 6)",
    cases: [
      { rawInput: 3, error: 0.1, expected: 1 },
      { rawInput: 0.1, error: 0.1, expected: 1 },
      { rawInput: 5.9, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "ReLU6",
    scenario: "dead zones at both ends",
    cases: [
      { rawInput: -1, error: -0.1, expected: 0 },
      { rawInput: 7, error: 0.1, expected: 0 },
    ],
  },
  {
    name: "ReLU6",
    scenario: "recovery from saturation",
    cases: [
      // x <= 0 with positive error → recovery
      { rawInput: -1, error: 0.1, expected: 1 },
      // x >= 6 with negative error → recovery
      { rawInput: 7, error: -0.1, expected: 1 },
    ],
  },
  {
    name: "GAUSSIAN",
    scenario: "full confidence near zero [-3, 3]",
    cases: [
      { rawInput: 0, error: 0.1, expected: 1 },
      { rawInput: 2, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "GAUSSIAN",
    scenario: "zero confidence far from zero with worsening error",
    cases: [
      // Raw > 3 and error > 0 → getting worse
      { rawInput: 5, error: 0.1, expected: 0 },
      // Raw < -3 and error < 0 → getting worse
      { rawInput: -5, error: -0.1, expected: 0 },
    ],
  },
  {
    name: "IDENTITY",
    scenario: "full confidence for normal inputs",
    cases: [
      { rawInput: 0, error: 0.1, expected: 1 },
      { rawInput: 100, error: 0.1, expected: 1 },
      { rawInput: -100, error: -0.1, expected: 1 },
    ],
  },
  {
    name: "IDENTITY",
    scenario: "zero confidence for extreme input with tiny weight",
    cases: [
      { rawInput: 2e6, error: 0.1, weight: 1e-7, expected: 0 },
      { rawInput: -2e6, error: -0.1, weight: 1e-7, expected: 0 },
    ],
  },
  {
    name: "STEP",
    scenario: "high confidence when on wrong side of threshold",
    cases: [
      // isAbove = true (rawInput > 0), expectedAbove = false (error < 0) → wrong side
      { rawInput: 1, error: -0.1, expected: 1 },
      // isAbove = false, expectedAbove = true → wrong side
      { rawInput: -1, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "STEP",
    scenario: "reduced confidence when on correct side",
    cases: [
      { rawInput: 1, error: 0.1, expected: 0.2, tolerance: 0.01 },
      { rawInput: -1, error: -0.1, expected: 0.2, tolerance: 0.01 },
    ],
  },
  {
    name: "ABSOLUTE",
    scenario: "full confidence for most inputs",
    cases: [
      { rawInput: 5, error: 0.1, expected: 1 },
      { rawInput: -5, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "ABSOLUTE",
    scenario: "full confidence for near-zero inputs",
    // Near-zero inputs should still have full confidence — the sign ambiguity
    // at zero does not warrant suppressing the gradient signal.
    cases: [
      { rawInput: 0.5, error: 0.1, expected: 1 },
      { rawInput: -0.5, error: -0.1, expected: 1 },
      { rawInput: 0.01, error: 0.1, expected: 1 },
      { rawInput: 0, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "ABSOLUTE",
    scenario: "zero for extreme input with tiny weight",
    cases: [{ rawInput: 2000, error: 0.1, weight: 1e-4, expected: 0 }],
  },
  {
    name: "Cosine",
    scenario: "high confidence where slope is strong",
    // At x = π/2, sin(x) = 1 → strong slope
    cases: [{ rawInput: Math.PI / 2, error: 0.1, expected: 1 }],
  },
  {
    name: "Cosine",
    scenario: "zero confidence at flat peaks",
    // At x = 0, sin(0) = 0 → flat
    cases: [{ rawInput: 0, error: 0.1, expected: 0 }],
  },
  {
    name: "SINE",
    scenario: "high confidence where cos is strong",
    // At x = 0, cos(0) = 1 → strong slope
    cases: [{ rawInput: 0, error: 0.1, expected: 1 }],
  },
  {
    name: "Exponential",
    scenario: "full confidence in safe zone [-10, 30]",
    cases: [
      { rawInput: 0, error: 0.1, expected: 1 },
      { rawInput: 20, error: 0.1, expected: 1 },
      { rawInput: -5, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "Exponential",
    scenario: "zero when far outside safe zone and worsening",
    cases: [
      // rawInput > 30 and error > 0 → worsening
      { rawInput: 50, error: 0.1, expected: 0 },
      // rawInput < -10 and error < 0 → worsening
      { rawInput: -30, error: -0.1, expected: 0 },
    ],
  },
  {
    name: "SQUARE",
    scenario: "full confidence in [-5, 5]",
    cases: [
      { rawInput: 0, error: 0.1, expected: 1 },
      { rawInput: 3, error: 0.1, expected: 1 },
      { rawInput: -5, error: 0.1, expected: 1 },
    ],
  },
  {
    name: "SQUARE",
    scenario: "fade zone between 5 and 10",
    cases: [
      // rawInput = 7.5, fade = 1 - (7.5 - 5) / 5 = 0.5
      { rawInput: 7.5, error: 0.1, expected: 0.5, tolerance: 0.01 },
    ],
  },
  {
    name: "SQUARE",
    scenario: "zero confidence beyond 10",
    cases: [{ rawInput: 11, error: 0.1, expected: 0 }],
  },
  {
    name: "SQUARE",
    scenario: "recovery zone allows small value",
    cases: [
      // rawInput > 5 and error < 0 → recovery
      { rawInput: 6, error: -0.1, expected: 0.2, tolerance: 0.01 },
      // rawInput < -5 and error > 0 → recovery
      { rawInput: -6, error: 0.1, expected: 0.2, tolerance: 0.01 },
    ],
  },
];

for (const scenario of SAFE_ZONE_SCENARIOS) {
  Deno.test(`${scenario.name}: ${scenario.scenario}`, () => {
    const activation = findSafeZoneActivation(scenario.name);
    for (const safeZoneCase of scenario.cases) {
      assertSafeZoneCase(activation, scenario.name, safeZoneCase);
    }
  });
}
