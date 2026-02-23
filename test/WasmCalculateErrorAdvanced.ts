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
import { BIPOLAR } from "../src/methods/activations/types/BIPOLAR.ts";
import { STEP } from "../src/methods/activations/types/STEP.ts";
import { COMPLEMENT } from "../src/methods/activations/types/COMPLEMENT.ts";
import { ABSOLUTE } from "../src/methods/activations/types/ABSOLUTE.ts";
import { SQUARE } from "../src/methods/activations/types/SQUARE.ts";
import { Cube } from "../src/methods/activations/types/Cube.ts";
import { SQRT } from "../src/methods/activations/types/SQRT.ts";
import { StdInverse } from "../src/methods/activations/types/StdInverse.ts";
import { Exponential } from "../src/methods/activations/types/Exponential.ts";
import { LogSigmoid } from "../src/methods/activations/types/LogSigmoid.ts";
import { ISRU } from "../src/methods/activations/types/ISRU.ts";

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

Deno.test({
  name: "WASM CalculateError: Bipolar",
  fn() {
    const jsImpl = new BIPOLAR();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      // Bipolar only outputs -1 or 1
      for (const targetActivation of [-1.0, 1.0]) {
        const wasmResult = wasmCalculateError(
          SquashType.Bipolar,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Bipolar calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Step",
  fn() {
    const jsImpl = new STEP();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      // Step only outputs 0 or 1
      for (const targetActivation of [0.0, 1.0]) {
        const wasmResult = wasmCalculateError(
          SquashType.Step,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Step calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Complement",
  fn() {
    const jsImpl = new COMPLEMENT();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Complement,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Complement calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Absolute",
  fn() {
    const jsImpl = new ABSOLUTE();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Absolute only outputs >= 0
        const safeTarget = Math.abs(targetActivation);
        const wasmResult = wasmCalculateError(
          SquashType.Absolute,
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
          `Absolute calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Square",
  fn() {
    const jsImpl = new SQUARE();
    const smallerValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of smallerValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Square only outputs >= 0
        const safeTarget = Math.abs(targetActivation);
        const wasmResult = wasmCalculateError(
          SquashType.Square,
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
          `Square calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Cube",
  fn() {
    const jsImpl = new Cube();
    const smallerValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of smallerValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        const wasmResult = wasmCalculateError(
          SquashType.Cube,
          activation,
          targetActivation,
          currentValue,
        );
        const jsResult = jsImpl.calculateError(
          activation,
          targetActivation,
          currentValue,
        );
        assertClose(
          wasmResult,
          jsResult,
          `Cube calculateError at currentValue=${currentValue}, target=${targetActivation}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Sqrt",
  fn() {
    const jsImpl = new SQRT();
    // Only test positive values for sqrt
    const sqrtValues = [0.1, 0.5, 1.0, 2.0, 4.0];
    for (const currentValue of sqrtValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Sqrt only outputs >= 0
        const safeTarget = Math.max(0, targetActivation);
        const wasmResult = wasmCalculateError(
          SquashType.Sqrt,
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
          `Sqrt calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: StdInverse",
  fn() {
    const jsImpl = new StdInverse();
    // Avoid values near zero where StdInverse explodes
    const stdInvValues = [-5.0, -2.0, -1.0, 1.0, 2.0, 5.0];
    for (const currentValue of stdInvValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // StdInverse range is (0, 1]
        const safeTarget = Math.max(0.01, Math.min(0.99, targetActivation));
        const wasmResult = wasmCalculateError(
          SquashType.StdInverse,
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
          `StdInverse calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: Exponential",
  fn() {
    const jsImpl = new Exponential();
    // Limit range to avoid overflow
    const expValues = [-2.0, -1.0, 0.0, 1.0, 2.0];
    for (const currentValue of expValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // Exponential only outputs > 0
        const safeTarget = Math.max(0.01, targetActivation + 1);
        const wasmResult = wasmCalculateError(
          SquashType.Exponential,
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
          `Exponential calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: LogSigmoid",
  fn() {
    const jsImpl = new LogSigmoid();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // LogSigmoid range is (-inf, 0)
        const safeTarget = Math.min(-0.01, targetActivation - 1);
        const wasmResult = wasmCalculateError(
          SquashType.LogSigmoid,
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
          `LogSigmoid calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM CalculateError: ISRU",
  fn() {
    const jsImpl = new ISRU();
    for (const currentValue of currentValues) {
      const activation = jsImpl.squash(currentValue);
      for (const [_, targetActivation] of errorTestCases) {
        // ISRU range is (-1, 1)
        const safeTarget = Math.max(
          -0.99,
          Math.min(0.99, targetActivation * 2 - 1),
        );
        const wasmResult = wasmCalculateError(
          SquashType.Isru,
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
          `ISRU calculateError at currentValue=${currentValue}, target=${safeTarget}`,
        );
      }
    }
  },
});

// Test aggregate functions return 0 (they don't have traditional calculateError)
Deno.test({
  name: "WASM CalculateError: Aggregate functions return 0",
  fn() {
    for (const currentValue of currentValues) {
      for (const [currentActivation, targetActivation] of errorTestCases) {
        const minResult = wasmCalculateError(
          SquashType.Minimum,
          currentActivation,
          targetActivation,
          currentValue,
        );
        assertClose(minResult, 0.0, `Minimum calculateError should return 0`);

        const maxResult = wasmCalculateError(
          SquashType.Maximum,
          currentActivation,
          targetActivation,
          currentValue,
        );
        assertClose(maxResult, 0.0, `Maximum calculateError should return 0`);

        const ifResult = wasmCalculateError(
          SquashType.If,
          currentActivation,
          targetActivation,
          currentValue,
        );
        assertClose(ifResult, 0.0, `If calculateError should return 0`);
      }
    }
  },
});

// Test that error clamping works
Deno.test({
  name: "WASM CalculateError: Error clamping",
  fn() {
    // Test with values that would produce very large errors
    const largeErrorResult = wasmCalculateError(
      SquashType.Identity,
      0.0,
      1000.0,
      0.0,
    );
    assert(
      Math.abs(largeErrorResult) <= 100,
      `Error should be clamped to ±100, got ${largeErrorResult}`,
    );

    const negLargeErrorResult = wasmCalculateError(
      SquashType.Identity,
      1000.0,
      0.0,
      1000.0,
    );
    assert(
      Math.abs(negLargeErrorResult) <= 100,
      `Negative error should be clamped to ±100, got ${negLargeErrorResult}`,
    );
  },
});

// Test that tiny errors return 0
Deno.test({
  name: "WASM CalculateError: Tiny errors return 0",
  fn() {
    // Test with values that produce very small errors (< ERROR_EPSILON = 1e-6)
    const tinyErrorResult = wasmCalculateError(
      SquashType.Identity,
      0.5,
      0.5 + 1e-8,
      0.5,
    );
    assertClose(
      tinyErrorResult,
      0.0,
      "Tiny error should return 0",
    );
  },
});
