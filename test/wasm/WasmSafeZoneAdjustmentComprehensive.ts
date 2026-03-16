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
import { SquashType, wasmSafeZoneAdjustment } from "../../src/wasm/mod.ts";

// Import JS activation implementations for comparison
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { ReLU } from "../../src/methods/activations/types/ReLU.ts";
import { ReLU6 } from "../../src/methods/activations/types/ReLU6.ts";
import { LeakyReLU } from "../../src/methods/activations/types/LeakyReLU.ts";
import { SELU } from "../../src/methods/activations/types/SELU.ts";
import { ELU } from "../../src/methods/activations/types/ELU.ts";
import { LOGISTIC } from "../../src/methods/activations/types/LOGISTIC.ts";
import { TANH } from "../../src/methods/activations/types/TANH.ts";
import { HARD_TANH } from "../../src/methods/activations/types/HARD_TANH.ts";
import { SOFTSIGN } from "../../src/methods/activations/types/SOFTSIGN.ts";
import { Softplus } from "../../src/methods/activations/types/Softplus.ts";
import { Swish } from "../../src/methods/activations/types/Swish.ts";
import { Mish } from "../../src/methods/activations/types/Mish.ts";
import { GELU } from "../../src/methods/activations/types/GELU.ts";
import { SINE } from "../../src/methods/activations/types/SINE.ts";
import { Cosine } from "../../src/methods/activations/types/Cosine.ts";
import { TAN } from "../../src/methods/activations/types/TAN.ts";
import { ArcTan } from "../../src/methods/activations/types/ArcTan.ts";
import { GAUSSIAN } from "../../src/methods/activations/types/GAUSSIAN.ts";
import { BENT_IDENTITY } from "../../src/methods/activations/types/BENT_IDENTITY.ts";
import { BIPOLAR_SIGMOID } from "../../src/methods/activations/types/BIPOLAR_SIGMOID.ts";
import { STEP } from "../../src/methods/activations/types/STEP.ts";
import { ABSOLUTE } from "../../src/methods/activations/types/ABSOLUTE.ts";
import { SQUARE } from "../../src/methods/activations/types/SQUARE.ts";
import { Cube } from "../../src/methods/activations/types/Cube.ts";
import { SQRT } from "../../src/methods/activations/types/SQRT.ts";
import { StdInverse } from "../../src/methods/activations/types/StdInverse.ts";
import { Exponential } from "../../src/methods/activations/types/Exponential.ts";
import { LogSigmoid } from "../../src/methods/activations/types/LogSigmoid.ts";
import { ISRU } from "../../src/methods/activations/types/ISRU.ts";

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

// Helper interface for testing
interface SafeZoneTestable {
  safeZoneAdjustment(rawInput: number, error: number, weight?: number): number;
}

// Comprehensive test comparing WASM and JS implementations
Deno.test({
  name: "WASM SafeZoneAdjustment: Comprehensive comparison",
  fn() {
    // Test a subset of combinations for comprehensive coverage
    const testInputSubset = [-10.0, -2.0, 0.0, 2.0, 10.0];
    const testErrorSubset = [-0.5, 0.0, 0.5];
    const testWeightSubset = [0.001, 1.0, 1000.0];

    interface TestCase {
      name: string;
      squashType: SquashType;
      jsImpl: SafeZoneTestable;
      usesWeight: boolean;
    }

    const testCases: TestCase[] = [
      {
        name: "IDENTITY",
        squashType: SquashType.Identity,
        jsImpl: new IDENTITY(),
        usesWeight: true,
      },
      {
        name: "ReLU",
        squashType: SquashType.Relu,
        jsImpl: new ReLU(),
        usesWeight: false,
      },
      {
        name: "ReLU6",
        squashType: SquashType.Relu6,
        jsImpl: new ReLU6(),
        usesWeight: false,
      },
      {
        name: "LeakyReLU",
        squashType: SquashType.LeakyRelu,
        jsImpl: new LeakyReLU(),
        usesWeight: true,
      },
      {
        name: "SELU",
        squashType: SquashType.Selu,
        jsImpl: new SELU(),
        usesWeight: true,
      },
      {
        name: "ELU",
        squashType: SquashType.Elu,
        jsImpl: new ELU(),
        usesWeight: true,
      },
      {
        name: "LOGISTIC",
        squashType: SquashType.Logistic,
        jsImpl: new LOGISTIC(),
        usesWeight: false,
      },
      {
        name: "TANH",
        squashType: SquashType.Tanh,
        jsImpl: new TANH(),
        usesWeight: false,
      },
      {
        name: "HardTanh",
        squashType: SquashType.HardTanh,
        jsImpl: new HARD_TANH(),
        usesWeight: false,
      },
      {
        name: "Softsign",
        squashType: SquashType.Softsign,
        jsImpl: new SOFTSIGN(),
        usesWeight: true,
      },
      {
        name: "Softplus",
        squashType: SquashType.Softplus,
        jsImpl: new Softplus(),
        usesWeight: true,
      },
      {
        name: "Swish",
        squashType: SquashType.Swish,
        jsImpl: new Swish(),
        usesWeight: true,
      },
      {
        name: "Mish",
        squashType: SquashType.Mish,
        jsImpl: new Mish(),
        usesWeight: true,
      },
      {
        name: "GELU",
        squashType: SquashType.Gelu,
        jsImpl: new GELU(),
        usesWeight: true,
      },
      {
        name: "SINE",
        squashType: SquashType.Sine,
        jsImpl: new SINE(),
        usesWeight: true,
      },
      {
        name: "Cosine",
        squashType: SquashType.Cosine,
        jsImpl: new Cosine(),
        usesWeight: true,
      },
      {
        name: "TAN",
        squashType: SquashType.Tan,
        jsImpl: new TAN(),
        usesWeight: true,
      },
      {
        name: "ArcTan",
        squashType: SquashType.ArcTan,
        jsImpl: new ArcTan(),
        usesWeight: true,
      },
      {
        name: "GAUSSIAN",
        squashType: SquashType.Gaussian,
        jsImpl: new GAUSSIAN(),
        usesWeight: true,
      },
      {
        name: "BentIdentity",
        squashType: SquashType.BentIdentity,
        jsImpl: new BENT_IDENTITY(),
        usesWeight: true,
      },
      {
        name: "BipolarSigmoid",
        squashType: SquashType.BipolarSigmoid,
        jsImpl: new BIPOLAR_SIGMOID(),
        usesWeight: true,
      },
      {
        name: "Step",
        squashType: SquashType.Step,
        jsImpl: new STEP(),
        usesWeight: true,
      },
      {
        name: "ABSOLUTE",
        squashType: SquashType.Absolute,
        jsImpl: new ABSOLUTE(),
        usesWeight: true,
      },
      {
        name: "SQUARE",
        squashType: SquashType.Square,
        jsImpl: new SQUARE(),
        usesWeight: true,
      },
      {
        name: "Cube",
        squashType: SquashType.Cube,
        jsImpl: new Cube(),
        usesWeight: true,
      },
      {
        name: "SQRT",
        squashType: SquashType.Sqrt,
        jsImpl: new SQRT(),
        usesWeight: true,
      },
      {
        name: "StdInverse",
        squashType: SquashType.StdInverse,
        jsImpl: new StdInverse(),
        usesWeight: true,
      },
      {
        name: "Exponential",
        squashType: SquashType.Exponential,
        jsImpl: new Exponential(),
        usesWeight: true,
      },
      {
        name: "LogSigmoid",
        squashType: SquashType.LogSigmoid,
        jsImpl: new LogSigmoid(),
        usesWeight: true,
      },
      {
        name: "ISRU",
        squashType: SquashType.Isru,
        jsImpl: new ISRU(),
        usesWeight: true,
      },
    ];

    let totalTests = 0;
    let passedTests = 0;

    for (const { name, squashType, jsImpl, usesWeight } of testCases) {
      for (const x of testInputSubset) {
        for (const e of testErrorSubset) {
          const weights = usesWeight ? testWeightSubset : [1.0];
          for (const w of weights) {
            totalTests++;
            try {
              const wasmResult = wasmSafeZoneAdjustment(squashType, x, e, w);
              const jsResult = usesWeight
                ? jsImpl.safeZoneAdjustment(x, e, w)
                : jsImpl.safeZoneAdjustment(x, e);
              assertClose(
                wasmResult,
                jsResult,
                `${name} at x=${x}, e=${e}, w=${w}`,
              );
              passedTests++;
            } catch (err) {
              console.error(
                `Failed: ${name} at x=${x}, e=${e}, w=${w}`,
                err,
              );
            }
          }
        }
      }
    }

    console.log(
      `Comprehensive SafeZoneAdjustment test: ${passedTests}/${totalTests} passed`,
    );
    assert(
      passedTests === totalTests,
      `All tests should pass: ${passedTests}/${totalTests}`,
    );
  },
});
