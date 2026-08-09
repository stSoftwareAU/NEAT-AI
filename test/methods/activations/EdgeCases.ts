/**
 * Unit tests for activation function edge-case behaviour.
 *
 * Tests behaviour at:
 * - x = 0 (often a special point)
 * - Large positive and large negative values
 * - Non-finite inputs (NaN, ±Infinity)
 * - Boundary values specific to each activation
 *
 * The x = 0, large-positive and large-negative families are table-driven
 * (Issue #3677): each former one-off test is now a row in a case table, run by
 * a single shared body and still reported as its own named test.
 *
 * @module
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Activations } from "@methods/activations/Activations.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";

/** Inclusive/exclusive range expectation for cases without an exact value. */
type SquashBounds = {
  /** Result must be strictly greater than this. */
  readonly gt?: number;
  /** Result must be greater than or equal to this. */
  readonly gte?: number;
  /** Result must be strictly less than this. */
  readonly lt?: number;
  /** Result must be less than or equal to this. */
  readonly lte?: number;
};

/**
 * One `squash(input)` expectation.
 *
 * Supply `expected` (with an optional `tolerance` — omit it for an exact
 * match) or `bounds` for the asymptotic cases where only a range is defined.
 */
type SquashCase = {
  readonly name: string;
  readonly input: number;
  readonly expected?: number;
  readonly tolerance?: number;
  readonly bounds?: SquashBounds;
};

function findActivation(name: string): ActivationInterface {
  return Activations.find(name) as unknown as ActivationInterface;
}

function describeBounds(bounds: SquashBounds): string {
  const parts: string[] = [];
  if (bounds.gt !== undefined) parts.push(`> ${bounds.gt}`);
  if (bounds.gte !== undefined) parts.push(`>= ${bounds.gte}`);
  if (bounds.lt !== undefined) parts.push(`< ${bounds.lt}`);
  if (bounds.lte !== undefined) parts.push(`<= ${bounds.lte}`);
  return parts.join(" and ");
}

function describeCase(testCase: SquashCase): string {
  const call = `${testCase.name}: squash(${testCase.input})`;
  if (testCase.expected !== undefined) {
    const operator = testCase.tolerance === undefined ? "=" : "≈";
    return `${call} ${operator} ${testCase.expected}`;
  }
  return `${call} ${describeBounds(testCase.bounds ?? {})}`;
}

function assertSquashCase(testCase: SquashCase): void {
  const activation = findActivation(testCase.name);
  const result = activation.squash(testCase.input);
  const label = `${testCase.name}(${testCase.input}) = ${result}`;

  if (testCase.expected !== undefined) {
    if (testCase.tolerance === undefined) {
      assertEquals(result, testCase.expected, label);
    } else {
      assertAlmostEquals(
        result,
        testCase.expected,
        testCase.tolerance,
        label,
      );
    }
  }

  const bounds = testCase.bounds;
  if (bounds) {
    if (bounds.gt !== undefined) {
      assert(result > bounds.gt, `${label}, expected > ${bounds.gt}`);
    }
    if (bounds.gte !== undefined) {
      assert(result >= bounds.gte, `${label}, expected >= ${bounds.gte}`);
    }
    if (bounds.lt !== undefined) {
      assert(result < bounds.lt, `${label}, expected < ${bounds.lt}`);
    }
    if (bounds.lte !== undefined) {
      assert(result <= bounds.lte, `${label}, expected <= ${bounds.lte}`);
    }
  }
}

/** Register one named test per case, so failures still name the activation. */
function registerSquashCases(cases: readonly SquashCase[]): void {
  for (const testCase of cases) {
    Deno.test(describeCase(testCase), () => assertSquashCase(testCase));
  }
}

// --- Behaviour at x = 0 ---

/** Every activation with a defined value at x = 0. */
const ZERO_CASES: readonly SquashCase[] = [
  { name: "ArcTan", input: 0, expected: 0, tolerance: 1e-10 },
  // (sqrt(0 + 1) - 1) / 2 + 0 = 0
  { name: "BENT_IDENTITY", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "COMPLEMENT", input: 0, expected: 1, tolerance: 1e-10 },
  { name: "Cosine", input: 0, expected: 1, tolerance: 1e-10 },
  { name: "Cube", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "ELU", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "Exponential", input: 0, expected: 1, tolerance: 1e-10 },
  { name: "GAUSSIAN", input: 0, expected: 1, tolerance: 1e-10 },
  { name: "HARD_TANH", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "IDENTITY", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "LOGISTIC", input: 0, expected: 0.5, tolerance: 1e-10 },
  { name: "ReLU", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "ReLU6", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "SINE", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "TANH", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "STEP", input: 0, expected: 0 },
  { name: "BIPOLAR", input: 0, expected: -1 },
  { name: "ABSOLUTE", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "SQUARE", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "SQRT", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "Softplus", input: 0, expected: Math.log(2), tolerance: 1e-6 },
  { name: "SOFTSIGN", input: 0, expected: 0, tolerance: 1e-10 },
  // Swish(0) = 0 * sigmoid(0) = 0 * 0.5 = 0
  { name: "Swish", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "GELU", input: 0, expected: 0, tolerance: 1e-6 },
  // Mish(0) = 0 * tanh(ln(2)) ≈ 0
  { name: "Mish", input: 0, expected: 0, tolerance: 1e-6 },
  { name: "LeakyReLU", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "ISRU", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "SELU", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "TAN", input: 0, expected: 0, tolerance: 1e-10 },
  // 2 * sigmoid(0) - 1 = 2 * 0.5 - 1 = 0
  { name: "BIPOLAR_SIGMOID", input: 0, expected: 0, tolerance: 1e-10 },
  { name: "LogSigmoid", input: 0, expected: -Math.log(2), tolerance: 1e-6 },
];

registerSquashCases(ZERO_CASES);

Deno.test("StdInverse: squash(0) produces large magnitude (1/x near zero)", () => {
  const a = findActivation("StdInverse");
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
    const activation = findActivation(name);

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

const LARGE_POSITIVE_CASES: readonly SquashCase[] = [
  { name: "LOGISTIC", input: 100, bounds: { gt: 0.99, lte: 1 } },
  { name: "TANH", input: 100, bounds: { gt: 0.99, lte: 1 } },
  { name: "ArcTan", input: 1000, expected: Math.PI / 2, tolerance: 0.01 },
  { name: "ReLU", input: 1000, expected: 1000 },
  { name: "HARD_TANH", input: 100, expected: 1 },
  { name: "GAUSSIAN", input: 100, expected: 0, tolerance: 1e-6 },
];

registerSquashCases(LARGE_POSITIVE_CASES);

// --- Large negative inputs ---

const LARGE_NEGATIVE_CASES: readonly SquashCase[] = [
  { name: "LOGISTIC", input: -100, bounds: { gte: 0, lt: 0.01 } },
  { name: "TANH", input: -100, bounds: { gte: -1, lt: -0.99 } },
  { name: "ArcTan", input: -1000, expected: -Math.PI / 2, tolerance: 0.01 },
  { name: "ReLU", input: -100, expected: 0 },
  { name: "HARD_TANH", input: -100, expected: -1 },
];

registerSquashCases(LARGE_NEGATIVE_CASES);

// --- Specific boundary values ---

Deno.test("HARD_TANH: boundary at ±1", () => {
  const a = findActivation("HARD_TANH");
  assertEquals(a.squash(1), 1);
  assertEquals(a.squash(-1), -1);
  // Just inside linear range
  assertAlmostEquals(a.squash(0.99), 0.99, 1e-10);
  assertAlmostEquals(a.squash(-0.99), -0.99, 1e-10);
});

Deno.test("ReLU6: boundary at 0 and 6", () => {
  const a = findActivation("ReLU6");
  assertEquals(a.squash(0), 0);
  assertEquals(a.squash(6), 6);
  assertEquals(a.squash(-1), 0);
  assertEquals(a.squash(7), 6);
});

Deno.test("BIPOLAR: boundary at 0", () => {
  const a = findActivation("BIPOLAR");
  assertEquals(a.squash(0), -1);
  assertEquals(a.squash(0.001), 1);
  assertEquals(a.squash(-0.001), -1);
});

Deno.test("STEP: boundary at 0", () => {
  const a = findActivation("STEP");
  assertEquals(a.squash(0), 0);
  assertEquals(a.squash(0.001), 1);
  assertEquals(a.squash(-0.001), 0);
});

Deno.test("SOFTSIGN: asymptotic approach to ±0.99 (clamped range)", () => {
  const a = findActivation("SOFTSIGN");
  const large = a.squash(1000);
  const smallNeg = a.squash(-1000);
  // SOFTSIGN range is clamped at ±0.99
  assertAlmostEquals(large, 0.99, 0.01);
  assertAlmostEquals(smallNeg, -0.99, 0.01);
});
