/**
 * WASM Derivative Unit Tests
 *
 * Issue #1138 - WASM Migration Phase 6: Implement derivative() in Rust/WASM
 *
 * These tests verify that the WASM derivative() produces the same results
 * as the JS-based derivative() implementations for all 32 standard activation functions.
 */

import { assert } from "@std/assert";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  SquashType,
  wasmDerivative,
} from "../src/wasm/mod.ts";

// Import JS activation implementations for comparison
import { IDENTITY } from "../src/methods/activations/types/IDENTITY.ts";
import { ReLU } from "../src/methods/activations/types/ReLU.ts";
import { ReLU6 } from "../src/methods/activations/types/ReLU6.ts";
import { LeakyReLU } from "../src/methods/activations/types/LeakyReLU.ts";
import { SELU } from "../src/methods/activations/types/SELU.ts";
import { ELU } from "../src/methods/activations/types/ELU.ts";
import { LOGISTIC } from "../src/methods/activations/types/LOGISTIC.ts";
import { TANH } from "../src/methods/activations/types/TANH.ts";
import { HARD_TANH } from "../src/methods/activations/types/HARD_TANH.ts";
import { SOFTSIGN } from "../src/methods/activations/types/SOFTSIGN.ts";
import { Softplus } from "../src/methods/activations/types/Softplus.ts";
import { Swish } from "../src/methods/activations/types/Swish.ts";
import { Mish } from "../src/methods/activations/types/Mish.ts";
import { GELU } from "../src/methods/activations/types/GELU.ts";
import { SINE } from "../src/methods/activations/types/SINE.ts";
import { Cosine } from "../src/methods/activations/types/Cosine.ts";
import { TAN } from "../src/methods/activations/types/TAN.ts";
import { ArcTan } from "../src/methods/activations/types/ArcTan.ts";
import { GAUSSIAN } from "../src/methods/activations/types/GAUSSIAN.ts";
import { BENT_IDENTITY } from "../src/methods/activations/types/BENT_IDENTITY.ts";
import { BIPOLAR_SIGMOID } from "../src/methods/activations/types/BIPOLAR_SIGMOID.ts";
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

// Get the project root directory for WASM module path
const projectRoot = new URL("..", import.meta.url).pathname;
const wasmPath = `${projectRoot}wasm_activation/pkg`;

// Initialise WASM before tests
Deno.test({
  name: "WASM Derivative: Module initialisation",
  async fn() {
    const result = await initWasmActivation(wasmPath);
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

Deno.test({
  name: "WASM Derivative: Identity",
  fn() {
    const jsImpl = new IDENTITY();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Identity, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Identity derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: ReLU",
  fn() {
    const jsImpl = new ReLU();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Relu, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `ReLU derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: ReLU6",
  fn() {
    const jsImpl = new ReLU6();
    // Add values specific to ReLU6 boundary at 6
    const values = [...testValues, 5.5, 5.9, 6.0, 6.1, 7.0];
    for (const x of values) {
      const wasmResult = wasmDerivative(SquashType.Relu6, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `ReLU6 derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: LeakyReLU",
  fn() {
    const jsImpl = new LeakyReLU();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.LeakyRelu, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `LeakyReLU derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: SELU",
  fn() {
    const jsImpl = new SELU();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Selu, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `SELU derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: ELU",
  fn() {
    const jsImpl = new ELU();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Elu, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `ELU derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: LOGISTIC (Sigmoid)",
  fn() {
    const jsImpl = new LOGISTIC();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Logistic, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `LOGISTIC derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: TANH",
  fn() {
    const jsImpl = new TANH();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Tanh, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `TANH derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: HardTanh",
  fn() {
    const jsImpl = new HARD_TANH();
    // Add values around the boundaries -1 and 1
    const values = [...testValues, -1.1, -0.99, 0.99, 1.1];
    for (const x of values) {
      const wasmResult = wasmDerivative(SquashType.HardTanh, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `HardTanh derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Softsign",
  fn() {
    const jsImpl = new SOFTSIGN();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Softsign, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Softsign derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Softplus",
  fn() {
    const jsImpl = new Softplus();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Softplus, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Softplus derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Swish",
  fn() {
    const jsImpl = new Swish();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Swish, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Swish derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Mish",
  fn() {
    const jsImpl = new Mish();
    // Mish has complex derivative, use smaller range to avoid numerical issues
    const values = [-5.0, -2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0, 5.0];
    for (const x of values) {
      const wasmResult = wasmDerivative(SquashType.Mish, x);
      const jsResult = jsImpl.derivative(x);
      // Use larger tolerance for Mish due to complex derivative formula
      assertClose(wasmResult, jsResult, `Mish derivative at x=${x}`, 1e-3);
    }
  },
});

Deno.test({
  name: "WASM Derivative: GELU",
  fn() {
    const jsImpl = new GELU();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Gelu, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `GELU derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: SINE",
  fn() {
    const jsImpl = new SINE();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Sine, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `SINE derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Cosine",
  fn() {
    const jsImpl = new Cosine();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Cosine, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Cosine derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: TAN",
  fn() {
    const jsImpl = new TAN();
    // Avoid values near pi/2 where tan is undefined
    const values = [-1.0, -0.5, 0.0, 0.5, 1.0];
    for (const x of values) {
      const wasmResult = wasmDerivative(SquashType.Tan, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `TAN derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: ArcTan",
  fn() {
    const jsImpl = new ArcTan();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.ArcTan, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `ArcTan derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: GAUSSIAN",
  fn() {
    const jsImpl = new GAUSSIAN();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Gaussian, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `GAUSSIAN derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: BentIdentity",
  fn() {
    const jsImpl = new BENT_IDENTITY();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.BentIdentity, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `BentIdentity derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: BipolarSigmoid",
  fn() {
    const jsImpl = new BIPOLAR_SIGMOID();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.BipolarSigmoid, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `BipolarSigmoid derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Bipolar",
  fn() {
    const jsImpl = new BIPOLAR();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Bipolar, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Bipolar derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Step",
  fn() {
    const jsImpl = new STEP();
    // Step has a special derivative near 0
    const values = [-1.0, -0.1, 0.1, 1.0];
    for (const x of values) {
      const wasmResult = wasmDerivative(SquashType.Step, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Step derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Complement",
  fn() {
    const jsImpl = new COMPLEMENT();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Complement, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Complement derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Absolute",
  fn() {
    const jsImpl = new ABSOLUTE();
    // Note: derivative at x=0 is undefined, both implementations return 0
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Absolute, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Absolute derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Square",
  fn() {
    const jsImpl = new SQUARE();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Square, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Square derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Cube",
  fn() {
    const jsImpl = new Cube();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Cube, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Cube derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Sqrt",
  fn() {
    const jsImpl = new SQRT();
    // Only test positive values for sqrt
    const values = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0];
    for (const x of values) {
      const wasmResult = wasmDerivative(SquashType.Sqrt, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Sqrt derivative at x=${x}`);
    }
    // Test edge case: x <= 0 should return 0
    const zeroResult = wasmDerivative(SquashType.Sqrt, 0.0);
    assertClose(zeroResult, 0.0, "Sqrt derivative at x=0");
    const negResult = wasmDerivative(SquashType.Sqrt, -1.0);
    assertClose(negResult, 0.0, "Sqrt derivative at x=-1");
  },
});

Deno.test({
  name: "WASM Derivative: StdInverse",
  fn() {
    const jsImpl = new StdInverse();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.StdInverse, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `StdInverse derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: Exponential",
  fn() {
    const jsImpl = new Exponential();
    // Limit range to avoid overflow
    const values = [-10.0, -5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.0];
    for (const x of values) {
      const wasmResult = wasmDerivative(SquashType.Exponential, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `Exponential derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: LogSigmoid",
  fn() {
    const jsImpl = new LogSigmoid();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.LogSigmoid, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `LogSigmoid derivative at x=${x}`);
    }
  },
});

Deno.test({
  name: "WASM Derivative: ISRU",
  fn() {
    const jsImpl = new ISRU();
    for (const x of testValues) {
      const wasmResult = wasmDerivative(SquashType.Isru, x);
      const jsResult = jsImpl.derivative(x);
      assertClose(wasmResult, jsResult, `ISRU derivative at x=${x}`);
    }
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

// Comprehensive test comparing WASM and JS implementations
Deno.test({
  name: "WASM Derivative: Comprehensive comparison with JS implementations",
  fn() {
    const implementations: Array<{
      name: string;
      squashType: SquashType;
      jsImpl: { derivative: (x: number) => number };
      testValues: number[];
      tolerance?: number;
    }> = [
      {
        name: "IDENTITY",
        squashType: SquashType.Identity,
        jsImpl: new IDENTITY(),
        testValues,
      },
      {
        name: "ReLU",
        squashType: SquashType.Relu,
        jsImpl: new ReLU(),
        testValues,
      },
      {
        name: "ReLU6",
        squashType: SquashType.Relu6,
        jsImpl: new ReLU6(),
        testValues: [...testValues, 5.5, 6.5],
      },
      {
        name: "LeakyReLU",
        squashType: SquashType.LeakyRelu,
        jsImpl: new LeakyReLU(),
        testValues,
      },
      {
        name: "SELU",
        squashType: SquashType.Selu,
        jsImpl: new SELU(),
        testValues,
      },
      {
        name: "ELU",
        squashType: SquashType.Elu,
        jsImpl: new ELU(),
        testValues,
      },
      {
        name: "LOGISTIC",
        squashType: SquashType.Logistic,
        jsImpl: new LOGISTIC(),
        testValues,
      },
      {
        name: "TANH",
        squashType: SquashType.Tanh,
        jsImpl: new TANH(),
        testValues,
      },
      {
        name: "HardTanh",
        squashType: SquashType.HardTanh,
        jsImpl: new HARD_TANH(),
        testValues,
      },
      {
        name: "Softsign",
        squashType: SquashType.Softsign,
        jsImpl: new SOFTSIGN(),
        testValues,
      },
      {
        name: "Softplus",
        squashType: SquashType.Softplus,
        jsImpl: new Softplus(),
        testValues,
      },
      {
        name: "Swish",
        squashType: SquashType.Swish,
        jsImpl: new Swish(),
        testValues,
      },
      {
        name: "Mish",
        squashType: SquashType.Mish,
        jsImpl: new Mish(),
        testValues: [-5, -2, -1, 0, 1, 2, 5],
        tolerance: 1e-3,
      },
      {
        name: "GELU",
        squashType: SquashType.Gelu,
        jsImpl: new GELU(),
        testValues,
      },
      {
        name: "SINE",
        squashType: SquashType.Sine,
        jsImpl: new SINE(),
        testValues,
      },
      {
        name: "Cosine",
        squashType: SquashType.Cosine,
        jsImpl: new Cosine(),
        testValues,
      },
      {
        name: "TAN",
        squashType: SquashType.Tan,
        jsImpl: new TAN(),
        testValues: [-1, -0.5, 0, 0.5, 1],
      },
      {
        name: "ArcTan",
        squashType: SquashType.ArcTan,
        jsImpl: new ArcTan(),
        testValues,
      },
      {
        name: "GAUSSIAN",
        squashType: SquashType.Gaussian,
        jsImpl: new GAUSSIAN(),
        testValues,
      },
      {
        name: "BentIdentity",
        squashType: SquashType.BentIdentity,
        jsImpl: new BENT_IDENTITY(),
        testValues,
      },
      {
        name: "BipolarSigmoid",
        squashType: SquashType.BipolarSigmoid,
        jsImpl: new BIPOLAR_SIGMOID(),
        testValues,
      },
      {
        name: "Bipolar",
        squashType: SquashType.Bipolar,
        jsImpl: new BIPOLAR(),
        testValues,
      },
      {
        name: "Step",
        squashType: SquashType.Step,
        jsImpl: new STEP(),
        testValues: [-1, -0.1, 0.1, 1],
      },
      {
        name: "Complement",
        squashType: SquashType.Complement,
        jsImpl: new COMPLEMENT(),
        testValues,
      },
      {
        name: "Absolute",
        squashType: SquashType.Absolute,
        jsImpl: new ABSOLUTE(),
        testValues,
      },
      {
        name: "Square",
        squashType: SquashType.Square,
        jsImpl: new SQUARE(),
        testValues,
      },
      {
        name: "Cube",
        squashType: SquashType.Cube,
        jsImpl: new Cube(),
        testValues,
      },
      {
        name: "Sqrt",
        squashType: SquashType.Sqrt,
        jsImpl: new SQRT(),
        testValues: [0.1, 0.5, 1, 2, 5, 10],
      },
      {
        name: "StdInverse",
        squashType: SquashType.StdInverse,
        jsImpl: new StdInverse(),
        testValues,
      },
      {
        name: "Exponential",
        squashType: SquashType.Exponential,
        jsImpl: new Exponential(),
        testValues: [-10, -5, -2, -1, 0, 1, 2, 3],
      },
      {
        name: "LogSigmoid",
        squashType: SquashType.LogSigmoid,
        jsImpl: new LogSigmoid(),
        testValues,
      },
      {
        name: "ISRU",
        squashType: SquashType.Isru,
        jsImpl: new ISRU(),
        testValues,
      },
    ];

    let totalTests = 0;
    let passedTests = 0;

    for (
      const { name, squashType, jsImpl, testValues: vals, tolerance }
        of implementations
    ) {
      for (const x of vals) {
        totalTests++;
        try {
          const wasmResult = wasmDerivative(squashType, x);
          const jsResult = jsImpl.derivative(x);
          assertClose(
            wasmResult,
            jsResult,
            `${name} derivative at x=${x}`,
            tolerance ?? TOLERANCE,
          );
          passedTests++;
        } catch (e) {
          console.error(`Failed: ${name} at x=${x}`, e);
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
