/**
 * WASM UnSquash Unit Tests
 *
 * Issue #1139 - WASM Migration Phase 7: Implement unSquash() in Rust/WASM
 *
 * These tests verify that the WASM unsquash() produces the same results
 * as the JS-based unSquash() implementations for all 32 standard activation functions.
 */

import { assert, assertAlmostEquals } from "@std/assert";
import {
  initWasmActivation,
  isWasmActivationAvailable,
  SquashType,
  wasmSquash,
  wasmUnSquash,
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
import type { UnSquashInterface } from "../src/methods/activations/UnSquashInterface.ts";
import type { ActivationInterface } from "../src/methods/activations/ActivationInterface.ts";

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
  name: "WASM UnSquash: Module initialisation",
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

/**
 * Test roundtrip: squash(x) -> unsquash(activation) should give back x
 * for invertible functions
 */
function testRoundtrip(
  name: string,
  squashType: SquashType,
  jsImpl: ActivationInterface & UnSquashInterface,
  values: number[],
  tolerancePercent: number = 1.0,
) {
  for (const x of values) {
    // Squash the value
    const activation = wasmSquash(squashType, x);
    if (!Number.isFinite(activation)) continue;

    // Check that activation is in range for the JS implementation
    const range = jsImpl.range;
    if (activation < range.low || activation > range.high) continue;

    // UnSquash using WASM with x as hint
    const recovered = wasmUnSquash(squashType, activation, x);

    // Calculate percentage error
    const expected = x;
    const percentage = Math.abs(expected) > 1e-10
      ? Math.abs((recovered - expected) / expected) * 100
      : Math.abs(recovered - expected) * 100;

    assert(
      percentage <= tolerancePercent + 1e-7,
      `${name} roundtrip failed: x=${x}, activation=${activation}, recovered=${recovered}, error=${
        percentage.toFixed(2)
      }%`,
    );
  }
}

/**
 * Compare WASM unSquash directly with JS unSquash
 */
function testMatchesJS(
  name: string,
  squashType: SquashType,
  jsImpl: UnSquashInterface,
  activations: number[],
  hints: (number | undefined)[],
  tolerance: number = TOLERANCE,
) {
  for (const activation of activations) {
    // Check that activation is in range for the JS implementation
    const range = jsImpl.range;
    if (
      !Number.isFinite(activation) || activation < range.low ||
      activation > range.high
    ) continue;

    for (const hint of hints) {
      const wasmResult = wasmUnSquash(squashType, activation, hint);
      const jsResult = jsImpl.unSquash(activation, hint);

      // Both should be finite
      if (!Number.isFinite(jsResult)) {
        assert(
          !Number.isFinite(wasmResult),
          `${name}: JS returned non-finite but WASM returned ${wasmResult}`,
        );
        continue;
      }

      assertClose(
        wasmResult,
        jsResult,
        `${name} unSquash(${activation}, ${hint})`,
        tolerance,
      );
    }
  }
}

Deno.test({
  name: "WASM UnSquash: Identity",
  fn() {
    const jsImpl = new IDENTITY();
    testRoundtrip("Identity", SquashType.Identity, jsImpl, testValues);
    testMatchesJS(
      "Identity",
      SquashType.Identity,
      jsImpl,
      testValues,
      [undefined, 0, 1, -1],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: ReLU",
  fn() {
    const jsImpl = new ReLU();
    // ReLU is not invertible for x <= 0, use hint for those cases
    const positiveValues = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0];
    testRoundtrip("ReLU", SquashType.Relu, jsImpl, positiveValues);

    // Test with hints for zero activation
    const zeroActivation = 0;
    const hint = -5;
    const wasmResult = wasmUnSquash(SquashType.Relu, zeroActivation, hint);
    const jsResult = jsImpl.unSquash(zeroActivation, hint);
    assertClose(wasmResult, jsResult, "ReLU unSquash(0, -5)");
  },
});

Deno.test({
  name: "WASM UnSquash: ReLU6",
  fn() {
    const jsImpl = new ReLU6();
    // ReLU6 is invertible for 0 < x < 6
    const values = [0.1, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 5.9];
    testRoundtrip("ReLU6", SquashType.Relu6, jsImpl, values);

    // Test boundary cases with hints
    testMatchesJS(
      "ReLU6",
      SquashType.Relu6,
      jsImpl,
      [0, 3, 6],
      [undefined, -1, 7],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: LeakyReLU",
  fn() {
    const jsImpl = new LeakyReLU();
    testRoundtrip("LeakyReLU", SquashType.LeakyRelu, jsImpl, testValues);
    testMatchesJS(
      "LeakyReLU",
      SquashType.LeakyRelu,
      jsImpl,
      [-1, -0.01, 0, 0.01, 1],
      [undefined],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: SELU",
  fn() {
    const jsImpl = new SELU();
    // SELU is complex, test roundtrip with tolerance
    const values = [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0];
    testRoundtrip("SELU", SquashType.Selu, jsImpl, values, 5.0);

    // Test that WASM matches JS
    const activations = jsImpl.range.high > 100
      ? [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0]
      : [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0];
    testMatchesJS("SELU", SquashType.Selu, jsImpl, activations, [
      undefined,
      -5,
    ]);
  },
});

Deno.test({
  name: "WASM UnSquash: ELU",
  fn() {
    const jsImpl = new ELU();
    const values = [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0];
    testRoundtrip("ELU", SquashType.Elu, jsImpl, values, 5.0);
    testMatchesJS(
      "ELU",
      SquashType.Elu,
      jsImpl,
      [-0.9, -0.5, 0, 0.5, 1],
      [undefined, -10],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: LOGISTIC",
  fn() {
    const jsImpl = new LOGISTIC();
    // Logistic output is in (0, 1), so test with inputs that stay in range
    const values = [-5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 5.0];
    testRoundtrip("LOGISTIC", SquashType.Logistic, jsImpl, values);

    // Test WASM matches JS for various activations
    const activations = [0.1, 0.3, 0.5, 0.7, 0.9];
    testMatchesJS("LOGISTIC", SquashType.Logistic, jsImpl, activations, [
      undefined,
    ]);
  },
});

Deno.test({
  name: "WASM UnSquash: TANH",
  fn() {
    const jsImpl = new TANH();
    const values = [-5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 5.0];
    testRoundtrip("TANH", SquashType.Tanh, jsImpl, values);

    // Test saturation handling
    const activations = [-0.9, -0.5, 0, 0.5, 0.9];
    testMatchesJS("TANH", SquashType.Tanh, jsImpl, activations, [
      undefined,
      10,
    ]);
  },
});

Deno.test({
  name: "WASM UnSquash: HardTanh",
  fn() {
    const jsImpl = new HARD_TANH();
    // HardTanh is not fully invertible at saturation
    const values = [-0.9, -0.5, 0.0, 0.5, 0.9];
    testRoundtrip("HardTanh", SquashType.HardTanh, jsImpl, values);

    // Test saturation with hints
    testMatchesJS(
      "HardTanh",
      SquashType.HardTanh,
      jsImpl,
      [-1, -0.5, 0, 0.5, 1],
      [undefined, -2, 2],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: Softsign",
  fn() {
    const jsImpl = new SOFTSIGN();
    const values = [-5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 5.0];
    testRoundtrip("Softsign", SquashType.Softsign, jsImpl, values);
    testMatchesJS(
      "Softsign",
      SquashType.Softsign,
      jsImpl,
      [-0.9, -0.5, 0, 0.5, 0.9],
      [undefined],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: Softplus",
  fn() {
    const jsImpl = new Softplus();
    const values = [-2.0, -1.0, 0.0, 1.0, 2.0, 5.0];
    testRoundtrip("Softplus", SquashType.Softplus, jsImpl, values, 2.0);

    // Softplus outputs are always positive
    const activations = [0.1, 0.5, 1.0, 2.0, 5.0];
    testMatchesJS("Softplus", SquashType.Softplus, jsImpl, activations, [
      undefined,
    ]);
  },
});

Deno.test({
  name: "WASM UnSquash: Swish",
  fn() {
    const jsImpl = new Swish();
    // Swish uses Newton-Raphson, needs higher tolerance
    const values = [-2.0, -1.0, 0.0, 1.0, 2.0, 5.0];
    testRoundtrip("Swish", SquashType.Swish, jsImpl, values, 5.0);

    // Test with hints
    const activations = [-0.3, 0, 0.5, 1.0, 2.0];
    testMatchesJS(
      "Swish",
      SquashType.Swish,
      jsImpl,
      activations,
      [undefined, 0, 1],
      0.01,
    );
  },
});

Deno.test({
  name: "WASM UnSquash: Mish",
  fn() {
    const jsImpl = new Mish();
    // Mish uses Newton-Raphson, needs higher tolerance
    const values = [-2.0, -1.0, 0.0, 1.0, 2.0];
    testRoundtrip("Mish", SquashType.Mish, jsImpl, values, 10.0);

    // Test that results are finite
    for (const x of [-5, 0, 5]) {
      const activation = wasmSquash(SquashType.Mish, x);
      const recovered = wasmUnSquash(SquashType.Mish, activation, x);
      assert(
        Number.isFinite(recovered),
        `Mish unSquash should be finite for x=${x}`,
      );
    }
  },
});

Deno.test({
  name: "WASM UnSquash: GELU",
  fn() {
    const jsImpl = new GELU();
    // GELU uses Newton-Raphson, needs higher tolerance
    const values = [-1.0, 0.0, 1.0, 2.0];
    testRoundtrip("GELU", SquashType.Gelu, jsImpl, values, 50.0);

    // Test that results are finite
    for (const x of [-2, 0, 2]) {
      const activation = wasmSquash(SquashType.Gelu, x);
      const recovered = wasmUnSquash(SquashType.Gelu, activation, x);
      assert(
        Number.isFinite(recovered),
        `GELU unSquash should be finite for x=${x}`,
      );
    }
  },
});

Deno.test({
  name: "WASM UnSquash: Sine",
  fn() {
    const jsImpl = new SINE();
    // Sine is periodic, test within one period with hints
    const values = [-1.0, -0.5, 0.0, 0.5, 1.0];
    testRoundtrip("Sine", SquashType.Sine, jsImpl, values, 5.0);

    // Test that result gives correct sine value
    for (const activation of [-0.5, 0, 0.5]) {
      const hint = 0;
      const result = wasmUnSquash(SquashType.Sine, activation, hint);
      const roundtrip = wasmSquash(SquashType.Sine, result);
      assertAlmostEquals(
        roundtrip,
        activation,
        0.01,
        `Sine unSquash(${activation})`,
      );
    }
  },
});

Deno.test({
  name: "WASM UnSquash: Cosine",
  fn() {
    const jsImpl = new Cosine();
    // Cosine is periodic, test with hints
    const values = [-1.0, 0.0, 1.0];
    testRoundtrip("Cosine", SquashType.Cosine, jsImpl, values, 5.0);

    // Test that result gives correct cosine value
    for (const activation of [-0.5, 0, 0.5, 1]) {
      const hint = 0;
      const result = wasmUnSquash(SquashType.Cosine, activation, hint);
      const roundtrip = wasmSquash(SquashType.Cosine, result);
      assertAlmostEquals(
        roundtrip,
        activation,
        0.01,
        `Cosine unSquash(${activation})`,
      );
    }
  },
});

Deno.test({
  name: "WASM UnSquash: Tan",
  fn() {
    const jsImpl = new TAN();
    // Tan is periodic with period pi
    const values = [-1.0, -0.5, 0.0, 0.5, 1.0];
    testRoundtrip("Tan", SquashType.Tan, jsImpl, values);
    testMatchesJS("Tan", SquashType.Tan, jsImpl, [-1, 0, 1], [undefined, 0]);
  },
});

Deno.test({
  name: "WASM UnSquash: ArcTan",
  fn() {
    const jsImpl = new ArcTan();
    const values = [-5.0, -1.0, 0.0, 1.0, 5.0];
    testRoundtrip("ArcTan", SquashType.ArcTan, jsImpl, values);

    // ArcTan output is in (-pi/2, pi/2)
    const activations = [-1.0, -0.5, 0, 0.5, 1.0];
    testMatchesJS("ArcTan", SquashType.ArcTan, jsImpl, activations, [
      undefined,
      0,
    ]);
  },
});

Deno.test({
  name: "WASM UnSquash: Gaussian",
  fn() {
    const jsImpl = new GAUSSIAN();
    // Gaussian: sign ambiguity, use hints
    const values = [-2.0, -1.0, 0.0, 1.0, 2.0];
    testRoundtrip("Gaussian", SquashType.Gaussian, jsImpl, values, 5.0);

    // Test with positive and negative hints
    const activation = wasmSquash(SquashType.Gaussian, 1);
    const positiveResult = wasmUnSquash(SquashType.Gaussian, activation, 1);
    const negativeResult = wasmUnSquash(SquashType.Gaussian, activation, -1);
    assert(positiveResult >= 0, "Positive hint should give positive result");
    assert(negativeResult <= 0, "Negative hint should give negative result");
  },
});

Deno.test({
  name: "WASM UnSquash: BentIdentity",
  fn() {
    const jsImpl = new BENT_IDENTITY();
    const values = [-5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 5.0];
    testRoundtrip("BentIdentity", SquashType.BentIdentity, jsImpl, values, 5.0);
    testMatchesJS(
      "BentIdentity",
      SquashType.BentIdentity,
      jsImpl,
      [-2, -1, 0, 1, 2],
      [undefined, 0],
      0.01,
    );
  },
});

Deno.test({
  name: "WASM UnSquash: BipolarSigmoid",
  fn() {
    const jsImpl = new BIPOLAR_SIGMOID();
    const values = [-5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 5.0];
    testRoundtrip("BipolarSigmoid", SquashType.BipolarSigmoid, jsImpl, values);

    // Test activations in (-1, 1)
    const activations = [-0.9, -0.5, 0, 0.5, 0.9];
    testMatchesJS(
      "BipolarSigmoid",
      SquashType.BipolarSigmoid,
      jsImpl,
      activations,
      [
        undefined,
      ],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: Bipolar",
  fn() {
    const jsImpl = new BIPOLAR();
    // Bipolar is not invertible, uses hints
    testMatchesJS(
      "Bipolar",
      SquashType.Bipolar,
      jsImpl,
      [-1, 1],
      [undefined, -0.5, 0.5],
    );

    // Test hint preservation when signs match
    const result = wasmUnSquash(SquashType.Bipolar, 1, 0.5);
    const jsResult = jsImpl.unSquash(1, 0.5);
    assertClose(result, jsResult, "Bipolar with positive hint");
  },
});

Deno.test({
  name: "WASM UnSquash: Step",
  fn() {
    const jsImpl = new STEP();
    // Step is not invertible, uses hints
    testMatchesJS(
      "Step",
      SquashType.Step,
      jsImpl,
      [0, 1],
      [undefined, -0.5, 0.5],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: Complement",
  fn() {
    const jsImpl = new COMPLEMENT();
    testRoundtrip("Complement", SquashType.Complement, jsImpl, testValues);
    testMatchesJS(
      "Complement",
      SquashType.Complement,
      jsImpl,
      [-1, 0, 1, 2],
      [undefined],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: Absolute",
  fn() {
    const jsImpl = new ABSOLUTE();
    // Absolute has sign ambiguity, use hints
    testMatchesJS(
      "Absolute",
      SquashType.Absolute,
      jsImpl,
      [0, 0.5, 1, 2],
      [undefined, -1, 1],
    );

    // Test that hint determines sign
    const positiveResult = wasmUnSquash(SquashType.Absolute, 2, 1);
    const negativeResult = wasmUnSquash(SquashType.Absolute, 2, -1);
    assertClose(positiveResult, 2, "Positive hint");
    assertClose(negativeResult, -2, "Negative hint");
  },
});

Deno.test({
  name: "WASM UnSquash: Square",
  fn() {
    const jsImpl = new SQUARE();
    // Square has sign ambiguity, use hints
    testMatchesJS(
      "Square",
      SquashType.Square,
      jsImpl,
      [0, 0.25, 1, 4],
      [undefined, -2, 2],
    );

    // Test that hint determines sign
    const positiveResult = wasmUnSquash(SquashType.Square, 4, 2);
    const negativeResult = wasmUnSquash(SquashType.Square, 4, -2);
    assertClose(positiveResult, 2, "Square positive hint");
    assertClose(negativeResult, -2, "Square negative hint");
  },
});

Deno.test({
  name: "WASM UnSquash: Cube",
  fn() {
    const jsImpl = new Cube();
    testRoundtrip("Cube", SquashType.Cube, jsImpl, testValues);
    testMatchesJS("Cube", SquashType.Cube, jsImpl, [-8, -1, 0, 1, 8], [
      undefined,
    ]);
  },
});

Deno.test({
  name: "WASM UnSquash: Sqrt",
  fn() {
    const jsImpl = new SQRT();
    // Sqrt: unSquash squares the value
    testMatchesJS(
      "Sqrt",
      SquashType.Sqrt,
      jsImpl,
      [0, 0.5, 1, 2],
      [undefined, -1, 1],
    );

    // Test with positive input
    const positiveValues = [0.1, 0.5, 1.0, 2.0, 5.0];
    testRoundtrip("Sqrt", SquashType.Sqrt, jsImpl, positiveValues, 1.0);
  },
});

Deno.test({
  name: "WASM UnSquash: StdInverse",
  fn() {
    const jsImpl = new StdInverse();
    // StdInverse: unSquash is 1/x
    const values = [-5.0, -2.0, -1.0, -0.5, 0.5, 1.0, 2.0, 5.0];
    testRoundtrip("StdInverse", SquashType.StdInverse, jsImpl, values, 1.0);
    testMatchesJS(
      "StdInverse",
      SquashType.StdInverse,
      jsImpl,
      [-2, -1, -0.5, 0.5, 1, 2],
      [undefined],
    );
  },
});

Deno.test({
  name: "WASM UnSquash: Exponential",
  fn() {
    const jsImpl = new Exponential();
    // Exponential: unSquash is log
    const values = [-5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.0];
    testRoundtrip("Exponential", SquashType.Exponential, jsImpl, values);

    // Test with positive activations
    const activations = [0.1, 0.5, 1, 2, 5];
    testMatchesJS("Exponential", SquashType.Exponential, jsImpl, activations, [
      undefined,
    ]);
  },
});

Deno.test({
  name: "WASM UnSquash: LogSigmoid",
  fn() {
    const jsImpl = new LogSigmoid();
    const values = [-5.0, -2.0, -1.0, 0.0, 1.0, 2.0, 5.0];
    testRoundtrip("LogSigmoid", SquashType.LogSigmoid, jsImpl, values, 5.0);

    // LogSigmoid outputs are always negative
    const activations = [-5, -2, -1, -0.5, -0.1];
    testMatchesJS("LogSigmoid", SquashType.LogSigmoid, jsImpl, activations, [
      undefined,
    ]);
  },
});

Deno.test({
  name: "WASM UnSquash: ISRU",
  fn() {
    const jsImpl = new ISRU();
    const values = [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0];
    testRoundtrip("ISRU", SquashType.Isru, jsImpl, values, 5.0);

    // ISRU output is bounded
    const activations = [-0.9, -0.5, 0, 0.5, 0.9];
    testMatchesJS("ISRU", SquashType.Isru, jsImpl, activations, [undefined]);
  },
});

// Test aggregate functions return hint or activation (since they're not invertible)
Deno.test({
  name: "WASM UnSquash: Aggregate functions use hint",
  fn() {
    const testActivations = [0, 1, -1, 5];
    const hint = 42;

    for (const activation of testActivations) {
      // Aggregate functions should return hint when provided
      const minResult = wasmUnSquash(SquashType.Minimum, activation, hint);
      assert(
        minResult === hint || minResult === activation,
        `Minimum should return hint or activation`,
      );

      const maxResult = wasmUnSquash(SquashType.Maximum, activation, hint);
      assert(
        maxResult === hint || maxResult === activation,
        `Maximum should return hint or activation`,
      );

      const ifResult = wasmUnSquash(SquashType.If, activation, hint);
      assert(
        ifResult === hint || ifResult === activation,
        `If should return hint or activation`,
      );
    }
  },
});

// Comprehensive test comparing WASM roundtrip behaviour
Deno.test({
  name: "WASM UnSquash: Comprehensive roundtrip test",
  fn() {
    const implementations: Array<{
      name: string;
      squashType: SquashType;
      testValues: number[];
      tolerance?: number;
    }> = [
      {
        name: "IDENTITY",
        squashType: SquashType.Identity,
        testValues,
      },
      {
        name: "LeakyReLU",
        squashType: SquashType.LeakyRelu,
        testValues,
      },
      {
        name: "LOGISTIC",
        squashType: SquashType.Logistic,
        testValues: [-5, -2, -1, 0, 1, 2, 5],
      },
      {
        name: "TANH",
        squashType: SquashType.Tanh,
        testValues: [-5, -2, -1, 0, 1, 2, 5],
      },
      {
        name: "Softsign",
        squashType: SquashType.Softsign,
        testValues: [-5, -2, -1, 0, 1, 2, 5],
      },
      {
        name: "Complement",
        squashType: SquashType.Complement,
        testValues,
      },
      {
        name: "Cube",
        squashType: SquashType.Cube,
        testValues,
      },
      {
        name: "BipolarSigmoid",
        squashType: SquashType.BipolarSigmoid,
        testValues: [-5, -2, -1, 0, 1, 2, 5],
      },
    ];

    let totalTests = 0;
    let passedTests = 0;

    for (
      const { name, squashType, testValues: vals, tolerance } of implementations
    ) {
      for (const x of vals) {
        totalTests++;
        try {
          // Squash and unsquash
          const activation = wasmSquash(squashType, x);
          if (!Number.isFinite(activation)) continue;

          const recovered = wasmUnSquash(squashType, activation, x);
          const expected = x;
          const percentage = Math.abs(expected) > 1e-10
            ? Math.abs((recovered - expected) / expected) * 100
            : Math.abs(recovered - expected) * 100;

          const tol = tolerance ?? 5.0;
          assert(
            percentage <= tol,
            `${name} roundtrip failed at x=${x}: got ${recovered}, expected ${expected}`,
          );
          passedTests++;
        } catch (e) {
          console.error(`Failed: ${name} at x=${x}`, e);
        }
      }
    }

    console.log(
      `Comprehensive roundtrip test: ${passedTests}/${totalTests} passed`,
    );
    assert(
      passedTests === totalTests,
      `All tests should pass: ${passedTests}/${totalTests}`,
    );
  },
});

// Test edge cases for numerical stability
Deno.test({
  name: "WASM UnSquash: Edge cases and numerical stability",
  fn() {
    // Test that results are always finite for valid inputs
    const squashTypes = [
      SquashType.Identity,
      SquashType.Relu,
      SquashType.LeakyRelu,
      SquashType.Logistic,
      SquashType.Tanh,
      SquashType.Softsign,
      SquashType.Complement,
    ];

    const edgeActivations = [0, Number.EPSILON, -Number.EPSILON];

    for (const squashType of squashTypes) {
      for (const activation of edgeActivations) {
        const result = wasmUnSquash(squashType, activation);
        assert(
          Number.isFinite(result),
          `UnSquash(${squashType}, ${activation}) should be finite, got ${result}`,
        );
      }
    }
  },
});
