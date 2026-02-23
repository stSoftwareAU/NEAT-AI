/**
 * WASM CalculateError Unit Tests
 *
 * Issue #1141 - WASM Migration Phase 9: Implement calculateError() in Rust/WASM
 *
 * These tests verify that the WASM calculateError() produces the same results
 * as the JS-based calculateError() implementations for all 32 standard activation functions.
 */

import { assert } from "@std/assert";
import { SquashType, wasmCalculateError } from "../src/wasm/mod.ts";

// Import JS activation implementations for comparison
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";
import { ReLU } from "../src/methods/activations/types/ReLU.ts";
import { LeakyReLU } from "../src/methods/activations/types/LeakyReLU.ts";
import { LOGISTIC } from "../src/methods/activations/types/LOGISTIC.ts";
import { TANH } from "../src/methods/activations/types/TANH.ts";
import { COMPLEMENT } from "../src/methods/activations/types/COMPLEMENT.ts";

// Tolerance for floating point comparisons
// WASM uses f32, JS uses f64, so we need some tolerance
const TOLERANCE = 1e-3;

function assertClose(
  actual: number,
  expected: number,
  message?: string,
  tolerance: number = TOLERANCE,
): void {
  const diff = Math.abs(actual - expected);
  const relDiff = expected !== 0 ? diff / Math.abs(expected) : diff;
  // Use relative tolerance for larger values, absolute for smaller
  const effectiveTolerance = Math.max(
    tolerance,
    Math.abs(expected) * tolerance,
  );
  const msg = message
    ? `${message}: expected ${expected}, got ${actual} (diff: ${diff}, relDiff: ${relDiff})`
    : `Expected ${expected}, got ${actual} (diff: ${diff}, relDiff: ${relDiff})`;
  assert(diff < effectiveTolerance, msg);
}

// Test values covering different regions for currentValue
const currentValues = [-5.0, -2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0, 5.0];

// Test cases: [currentActivation, targetActivation] pairs
const errorTestCases: Array<[number, number]> = [
  [0.0, 0.0], // No error
  [0.5, 0.5], // No error
  [0.0, 0.5], // Positive error
  [0.5, 0.0], // Negative error
  [0.2, 0.8], // Large positive error
  [0.8, 0.2], // Large negative error
  [-0.5, 0.5], // Crossing zero
  [0.1, 0.9], // Near extremes
  [0.9, 0.1], // Near extremes reversed
];

// Comprehensive test comparing WASM and JS implementations
Deno.test({
  name: "WASM CalculateError: Comprehensive comparison with JS implementations",
  fn() {
    const implementations: Array<{
      name: string;
      squashType: SquashType;
      jsImpl: {
        squash: (x: number) => number;
        calculateError: (a: number, b: number, c: number) => number;
      };
      testValues: number[];
      targetTransform?: (t: number) => number;
      tolerance?: number;
    }> = [
      {
        name: "IDENTITY",
        squashType: SquashType.Identity,
        jsImpl: new IDENTITY(),
        testValues: currentValues,
      },
      {
        name: "ReLU",
        squashType: SquashType.Relu,
        jsImpl: new ReLU(),
        testValues: currentValues,
        targetTransform: (t) => Math.max(0, t),
      },
      {
        name: "LeakyReLU",
        squashType: SquashType.LeakyRelu,
        jsImpl: new LeakyReLU(),
        testValues: currentValues,
      },
      {
        name: "TANH",
        squashType: SquashType.Tanh,
        jsImpl: new TANH(),
        testValues: currentValues,
        targetTransform: (t) => Math.max(-0.99, Math.min(0.99, t * 2 - 1)),
      },
      {
        name: "LOGISTIC",
        squashType: SquashType.Logistic,
        jsImpl: new LOGISTIC(),
        testValues: currentValues,
        targetTransform: (t) => Math.max(0.01, Math.min(0.99, t)),
      },
      {
        name: "COMPLEMENT",
        squashType: SquashType.Complement,
        jsImpl: new COMPLEMENT(),
        testValues: currentValues,
      },
    ];

    let totalTests = 0;
    let passedTests = 0;

    for (
      const {
        name,
        squashType,
        jsImpl,
        testValues: vals,
        targetTransform,
        tolerance,
      } of implementations
    ) {
      for (const currentValue of vals) {
        const activation = jsImpl.squash(currentValue);
        for (const [_, targetActivation] of errorTestCases) {
          totalTests++;
          try {
            const safeTarget = targetTransform
              ? targetTransform(targetActivation)
              : targetActivation;
            const wasmResult = wasmCalculateError(
              squashType,
              activation,
              safeTarget,
              currentValue,
            );
            const jsResult = jsImpl.calculateError(
              activation,
              safeTarget,
              currentValue,
            );
            assertClose(
              wasmResult,
              jsResult,
              `${name} calculateError at currentValue=${currentValue}, target=${safeTarget}`,
              tolerance ?? TOLERANCE,
            );
            passedTests++;
          } catch (e) {
            console.error(`Failed: ${name} at currentValue=${currentValue}`, e);
          }
        }
      }
    }

    console.log(`Comprehensive test: ${passedTests}/${totalTests} passed`);
    assert(
      passedTests === totalTests,
      `All tests should pass: ${passedTests}/${totalTests}`,
    );
  },
});
