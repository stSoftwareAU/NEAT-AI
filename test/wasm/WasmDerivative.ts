/**
 * WASM Derivative Unit Tests
 *
 * Issue #1138 - WASM Migration Phase 6: Implement derivative() in Rust/WASM
 *
 * These tests verify that the WASM derivative() produces the same results
 * as the JS-based derivative() implementations for all 32 standard activation functions.
 *
 * The per-activation comparisons are table-driven (Issue #3677): each row names
 * the activation, its `SquashType`, the JS implementation to compare against,
 * and any per-activation value set or tolerance. One body runs them all, still
 * reporting each activation as its own named test.
 */

import { assert } from "@std/assert";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  SquashType,
  wasmDerivative,
} from "@wasm/mod.ts";

// Import JS activation implementations for comparison
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { ReLU } from "@methods/activations/types/ReLU.ts";
import { ReLU6 } from "@methods/activations/types/ReLU6.ts";
import { LeakyReLU } from "@methods/activations/types/LeakyReLU.ts";
import { SELU } from "@methods/activations/types/SELU.ts";
import { ELU } from "@methods/activations/types/ELU.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";
import { TANH } from "@methods/activations/types/TANH.ts";
import { HARD_TANH } from "@methods/activations/types/HARD_TANH.ts";
import { SOFTSIGN } from "@methods/activations/types/SOFTSIGN.ts";
import { Softplus } from "@methods/activations/types/Softplus.ts";
import { Swish } from "@methods/activations/types/Swish.ts";
import { Mish } from "@methods/activations/types/Mish.ts";
import { GELU } from "@methods/activations/types/GELU.ts";
import { SINE } from "@methods/activations/types/SINE.ts";
import { Cosine } from "@methods/activations/types/Cosine.ts";
import { TAN } from "@methods/activations/types/TAN.ts";
import { ArcTan } from "@methods/activations/types/ArcTan.ts";
import { GAUSSIAN } from "@methods/activations/types/GAUSSIAN.ts";
import { BENT_IDENTITY } from "@methods/activations/types/BENT_IDENTITY.ts";
import { BIPOLAR_SIGMOID } from "@methods/activations/types/BIPOLAR_SIGMOID.ts";
import { BIPOLAR } from "@methods/activations/types/BIPOLAR.ts";
import { STEP } from "@methods/activations/types/STEP.ts";
import { COMPLEMENT } from "@methods/activations/types/COMPLEMENT.ts";
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

// Initialise WASM before tests
Deno.test({
  name: "WASM Derivative: Module initialisation",
  async fn() {
    const result = await initWasmActivation();
    assert(result, "WASM module should initialise successfully");
    assert(isWasmActivationAvailable(), "WASM should be available after init");
  },
});

// Test values covering different regions
const testValues = [
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
];

/** JS activation implementations expose a derivative for comparison. */
type JsDerivative = { derivative(x: number): number };

/** One WASM-vs-JS derivative comparison. */
type DerivativeCase = {
  /** Label used in the step name and assertion messages. */
  readonly name: string;
  /** WASM squash type under test. */
  readonly type: SquashType;
  /** JS implementation the WASM result must match. */
  readonly js: JsDerivative;
  /** Values to compare at; defaults to the shared `testValues`. */
  readonly values?: readonly number[];
  /** Per-activation tolerance override. */
  readonly tolerance?: number;
};

const DERIVATIVE_CASES: readonly DerivativeCase[] = [
  { name: "Identity", type: SquashType.Identity, js: new IDENTITY() },
  { name: "ReLU", type: SquashType.Relu, js: new ReLU() },
  {
    name: "ReLU6",
    type: SquashType.Relu6,
    js: new ReLU6(),
    // Add values specific to ReLU6 boundary at 6
    values: [...testValues, 5.5, 5.9, 6.0, 6.1, 7.0],
  },
  { name: "LeakyReLU", type: SquashType.LeakyRelu, js: new LeakyReLU() },
  { name: "SELU", type: SquashType.Selu, js: new SELU() },
  { name: "ELU", type: SquashType.Elu, js: new ELU() },
  { name: "LOGISTIC", type: SquashType.Logistic, js: new LOGISTIC() },
  { name: "TANH", type: SquashType.Tanh, js: new TANH() },
  {
    name: "HardTanh",
    type: SquashType.HardTanh,
    js: new HARD_TANH(),
    // Add values around the boundaries -1 and 1
    values: [...testValues, -1.1, -0.99, 0.99, 1.1],
  },
  { name: "Softsign", type: SquashType.Softsign, js: new SOFTSIGN() },
  { name: "Softplus", type: SquashType.Softplus, js: new Softplus() },
  { name: "Swish", type: SquashType.Swish, js: new Swish() },
  {
    name: "Mish",
    type: SquashType.Mish,
    js: new Mish(),
    // Mish has complex derivative, use smaller range to avoid numerical issues
    values: [-5.0, -2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0, 5.0],
    // Use larger tolerance for Mish due to complex derivative formula
    tolerance: 1e-3,
  },
  { name: "GELU", type: SquashType.Gelu, js: new GELU() },
  { name: "SINE", type: SquashType.Sine, js: new SINE() },
  { name: "Cosine", type: SquashType.Cosine, js: new Cosine() },
  {
    name: "TAN",
    type: SquashType.Tan,
    js: new TAN(),
    // Avoid values near pi/2 where tan is undefined
    values: [-1.0, -0.5, 0.0, 0.5, 1.0],
  },
  { name: "ArcTan", type: SquashType.ArcTan, js: new ArcTan() },
  { name: "GAUSSIAN", type: SquashType.Gaussian, js: new GAUSSIAN() },
  {
    name: "BentIdentity",
    type: SquashType.BentIdentity,
    js: new BENT_IDENTITY(),
  },
  {
    name: "BipolarSigmoid",
    type: SquashType.BipolarSigmoid,
    js: new BIPOLAR_SIGMOID(),
  },
  { name: "Bipolar", type: SquashType.Bipolar, js: new BIPOLAR() },
  {
    name: "Step",
    type: SquashType.Step,
    js: new STEP(),
    // Step has a special derivative near 0
    values: [-1.0, -0.1, 0.1, 1.0],
  },
  { name: "Complement", type: SquashType.Complement, js: new COMPLEMENT() },
  // Note: derivative at x=0 is undefined, both implementations return 0
  { name: "Absolute", type: SquashType.Absolute, js: new ABSOLUTE() },
  { name: "Square", type: SquashType.Square, js: new SQUARE() },
  { name: "Cube", type: SquashType.Cube, js: new Cube() },
  {
    name: "Sqrt",
    type: SquashType.Sqrt,
    js: new SQRT(),
    // Only test positive values for sqrt
    values: [0.1, 0.5, 1.0, 2.0, 5.0, 10.0],
  },
  { name: "StdInverse", type: SquashType.StdInverse, js: new StdInverse() },
  {
    name: "Exponential",
    type: SquashType.Exponential,
    js: new Exponential(),
    // Limit range to avoid overflow
    values: [-10.0, -5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.0],
  },
  { name: "LogSigmoid", type: SquashType.LogSigmoid, js: new LogSigmoid() },
  { name: "ISRU", type: SquashType.Isru, js: new ISRU() },
];

for (const derivativeCase of DERIVATIVE_CASES) {
  Deno.test({
    name: `WASM Derivative: ${derivativeCase.name}`,
    fn() {
      for (const x of derivativeCase.values ?? testValues) {
        const wasmResult = wasmDerivative(derivativeCase.type, x);
        const jsResult = derivativeCase.js.derivative(x);
        assertClose(
          wasmResult,
          jsResult,
          `${derivativeCase.name} derivative at x=${x}`,
          derivativeCase.tolerance,
        );
      }
    },
  });
}

Deno.test({
  name: "WASM Derivative: Sqrt returns 0 for x <= 0",
  fn() {
    const zeroResult = wasmDerivative(SquashType.Sqrt, 0.0);
    assertClose(zeroResult, 0.0, "Sqrt derivative at x=0");
    const negResult = wasmDerivative(SquashType.Sqrt, -1.0);
    assertClose(negResult, 0.0, "Sqrt derivative at x=-1");
  },
});

// Test aggregate functions return 0 (they don't have traditional derivatives)
Deno.test({
  name: "WASM Derivative: Aggregate functions return 0",
  fn() {
    for (const x of testValues) {
      const minResult = wasmDerivative(SquashType.Minimum, x);
      assertClose(minResult, 0.0, `Minimum derivative at x=${x}`);

      const maxResult = wasmDerivative(SquashType.Maximum, x);
      assertClose(maxResult, 0.0, `Maximum derivative at x=${x}`);

      const ifResult = wasmDerivative(SquashType.If, x);
      assertClose(ifResult, 0.0, `If derivative at x=${x}`);
    }
  },
});

// NOTE (Issue #3172): the former "Comprehensive comparison with JS
// implementations" test was removed as redundant. Every squash type it
// compared (all 32) already has a dedicated per-function case in
// DERIVATIVE_CASES above running the identical wasmDerivative-vs-jsImpl
// .derivative assertClose check over an equal-or-wider set of values with the
// same tolerance, so it exercised no additional derivative code path.
