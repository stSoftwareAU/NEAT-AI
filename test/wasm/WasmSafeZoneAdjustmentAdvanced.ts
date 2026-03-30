/**
 * WASM Safe Zone Adjustment Unit Tests
 *
 * Issue #1140 - WASM Migration Phase 8: Implement safeZoneAdjustment() in Rust/WASM
 *
 * These tests verify that the WASM safeZoneAdjustment() produces the same results
 * as the JS-based safeZoneAdjustment() implementations for all activation functions.
 *
 * The safeZoneAdjustment function returns a float from 0 (not safe) to 1 (fully safe)
 * indicating how useful it is to backpropagate through a neuron.
 */

import { assert } from "@std/assert";
import { SquashType, wasmSafeZoneAdjustment } from "@wasm/mod.ts";
import { STEP } from "@methods/activations/types/STEP.ts";
import { ABSOLUTE } from "@methods/activations/types/ABSOLUTE.ts";
import { SQUARE } from "@methods/activations/types/SQUARE.ts";
import { Cube } from "@methods/activations/types/Cube.ts";
import { SQRT } from "@methods/activations/types/SQRT.ts";
import { StdInverse } from "@methods/activations/types/StdInverse.ts";
import { Exponential } from "@methods/activations/types/Exponential.ts";
import { LogSigmoid } from "@methods/activations/types/LogSigmoid.ts";
import { ISRU } from "@methods/activations/types/ISRU.ts";

// Tolerance for floating point comparisons
// WASM uses f32, JS uses f64, so we need some tolerance
const TOLERANCE = 1e-4;

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

// Test values covering different regions
const testInputs = [
  -20.0,
  -10.0,
  -5.0,
  -2.0,
  -1.0,
  -0.5,
  -0.1,
  0.0,
  0.1,
  0.5,
  1.0,
  2.0,
  5.0,
  10.0,
  20.0,
];

// Error values to test with
const testErrors = [-1.0, -0.5, -0.1, 0.0, 0.1, 0.5, 1.0];

// Weight values to test with
const testWeights = [0.0001, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0, 1000.0];

// Helper interface for testing
interface SafeZoneTestable {
  safeZoneAdjustment(rawInput: number, error: number, weight?: number): number;
}

// BIPOLAR and STEP are discontinuous functions - they should always return 0
// (BIPOLAR has no safeZoneAdjustment in JS, STEP has a special implementation)
Deno.test({
  name: "WASM SafeZoneAdjustment: Bipolar returns 0",
  fn() {
    // Bipolar is discontinuous - should always return 0
    for (const x of testInputs) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Bipolar, x, e);
        assertClose(
          wasmResult,
          0.0,
          `Bipolar safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Step",
  fn() {
    const jsImpl = new STEP();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Step, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Step safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: ABSOLUTE",
  fn() {
    const jsImpl = new ABSOLUTE();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.Absolute,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `ABSOLUTE safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: SQUARE",
  fn() {
    const jsImpl = new SQUARE();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Square, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `SQUARE safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Cube",
  fn() {
    const jsImpl = new Cube();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Cube, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Cube safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: SQRT",
  fn() {
    const jsImpl = new SQRT();
    // Only test values that make sense for SQRT (mainly positive range)
    const values = [
      -5.0,
      -1.0,
      -0.1,
      0.0,
      0.01,
      0.1,
      0.5,
      1.0,
      5.0,
      10.0,
      20.0,
    ];
    for (const x of values) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Sqrt, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `SQRT safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: StdInverse",
  fn() {
    const jsImpl = new StdInverse();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.StdInverse,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `StdInverse safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: Exponential",
  fn() {
    const jsImpl = new Exponential();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.Exponential,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `Exponential safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: LogSigmoid",
  fn() {
    const jsImpl = new LogSigmoid();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(
            SquashType.LogSigmoid,
            x,
            e,
            w,
          );
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `LogSigmoid safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

Deno.test({
  name: "WASM SafeZoneAdjustment: ISRU",
  fn() {
    const jsImpl = new ISRU();
    for (const x of testInputs) {
      for (const e of testErrors) {
        for (const w of testWeights) {
          const wasmResult = wasmSafeZoneAdjustment(SquashType.Isru, x, e, w);
          const jsResult = jsImpl.safeZoneAdjustment(x, e, w);
          assertClose(
            wasmResult,
            jsResult,
            `ISRU safeZoneAdjustment at x=${x}, error=${e}, weight=${w}`,
          );
        }
      }
    }
  },
});

// Test aggregate functions return 0 (they don't have safeZoneAdjustment in traditional sense)
Deno.test({
  name: "WASM SafeZoneAdjustment: Aggregate functions return 0",
  fn() {
    for (const x of testInputs) {
      for (const e of testErrors) {
        const minResult = wasmSafeZoneAdjustment(SquashType.Minimum, x, e);
        assertClose(minResult, 0.0, `Minimum safeZoneAdjustment at x=${x}`);

        const maxResult = wasmSafeZoneAdjustment(SquashType.Maximum, x, e);
        assertClose(maxResult, 0.0, `Maximum safeZoneAdjustment at x=${x}`);

        const ifResult = wasmSafeZoneAdjustment(SquashType.If, x, e);
        assertClose(ifResult, 0.0, `If safeZoneAdjustment at x=${x}`);
      }
    }
  },
});

// Test COMPLEMENT - doesn't have safeZoneAdjustment in JS, should return 1.0 (never saturates)
Deno.test({
  name: "WASM SafeZoneAdjustment: Complement returns 1.0",
  fn() {
    for (const x of testInputs) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Complement, x, e);
        assertClose(
          wasmResult,
          1.0,
          `Complement safeZoneAdjustment at x=${x}, error=${e}`,
        );
      }
    }
  },
});

// Test non-finite inputs
Deno.test({
  name: "WASM SafeZoneAdjustment: Non-finite inputs return 0",
  fn() {
    const nonFiniteValues = [Infinity, -Infinity, NaN];
    for (const x of nonFiniteValues) {
      for (const e of testErrors) {
        const wasmResult = wasmSafeZoneAdjustment(SquashType.Tanh, x, e);
        assertClose(wasmResult, 0.0, `Non-finite input ${x} should return 0`);
      }
    }
  },
});
