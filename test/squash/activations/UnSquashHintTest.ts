import { assertAlmostEquals } from "@std/assert";
import { GELU } from "../../../src/methods/activations/types/GELU.ts";
import { Cosine } from "../../../src/methods/activations/types/Cosine.ts";
import { SINE } from "../../../src/methods/activations/types/SINE.ts";
import { TANH } from "../../../src/methods/activations/types/TANH.ts";
import { LOGISTIC } from "../../../src/methods/activations/types/LOGISTIC.ts";
import { RELU } from "../../../src/methods/activations/types/RELU.ts";
import { LeakyReLU } from "../../../src/methods/activations/types/LeakyReLU.ts";
import { ELU } from "../../../src/methods/activations/types/ELU.ts";
import { Swish } from "../../../src/methods/activations/types/Swish.ts";
import { Mish } from "../../../src/methods/activations/types/Mish.ts";
import { Softplus } from "../../../src/methods/activations/types/Softplus.ts";
import { ReLU6 } from "../../../src/methods/activations/types/ReLU6.ts";
import { SELU } from "../../../src/methods/activations/types/SELU.ts";
import { STEP } from "../../../src/methods/activations/types/STEP.ts";
import { TAN } from "../../../src/methods/activations/types/TAN.ts";
import { ABSOLUTE } from "../../../src/methods/activations/types/ABSOLUTE.ts";
import { ArcTan } from "../../../src/methods/activations/types/ArcTan.ts";
import { BIPOLAR } from "../../../src/methods/activations/types/BIPOLAR.ts";
import { COMPLEMENT } from "../../../src/methods/activations/types/COMPLEMENT.ts";
import { GAUSSIAN } from "../../../src/methods/activations/types/GAUSSIAN.ts";
import { HARD_TANH } from "../../../src/methods/activations/types/HARD_TANH.ts";
import { IDENTITY } from "../../../src/methods/activations/types/IDENTITY.ts";
import { SOFTSIGN } from "../../../src/methods/activations/types/SOFTSIGN.ts";
import { LogSigmoid } from "../../../src/methods/activations/types/LogSigmoid.ts";
import { ISRU } from "../../../src/methods/activations/types/ISRU.ts";
import { BIPOLAR_SIGMOID } from "../../../src/methods/activations/types/BIPOLAR_SIGMOID.ts";
import { Cube } from "../../../src/methods/activations/types/Cube.ts";
import { Exponential } from "../../../src/methods/activations/types/Exponential.ts";
import { BENT_IDENTITY } from "../../../src/methods/activations/types/BENT_IDENTITY.ts";
import type { ActivationInterface } from "../../../src/methods/activations/ActivationInterface.ts";
import type { UnSquashInterface } from "../../../src/methods/activations/UnSquashInterface.ts";

// Test helper function
function testUnSquashWithHint(
  activation: ActivationInterface & UnSquashInterface,
  testCases: Array<{
    activation: number;
    hint: number;
    expected: number;
    tolerance?: number;
  }>,
) {
  testCases.forEach((testCase) => {
    const { activation: act, hint, expected, tolerance = 0.01 } = testCase;

    // First verify that the expected value produces the given activation
    const expectedActivation = activation.squash(expected);
    assertAlmostEquals(
      expectedActivation,
      act,
      tolerance,
      `${activation.getName()} squash(${expected}) should produce ${act}, got ${expectedActivation}`,
    );

    // Then verify that unSquash with the hint produces a value that:
    // 1. Produces the same activation when squashed
    // 2. Is as close as possible to the hint while satisfying condition 1
    const result = activation.unSquash(act, hint);
    const resultActivation = activation.squash(result);

    // First check that the result produces the same activation
    assertAlmostEquals(
      resultActivation,
      act,
      tolerance,
      `${activation.getName()} squash(${result}) should produce ${act}, got ${resultActivation}`,
    );

    if (Math.abs(result - expected) > tolerance) {
      activation.unSquash(act, hint);
      console.log(
        `${activation.getName()} unSquash(${act}, ${hint}) should be close to ${expected}, got ${result}`,
      );
    }
    // Then check that the result is close to the expected value
    assertAlmostEquals(
      result,
      expected,
      tolerance,
      `${activation.getName()} unSquash(${act}, ${hint}) should be close to ${expected}, got ${result}`,
    );
  });
}

// GELU tests
Deno.test("GELU unSquash with hint", () => {
  const gelu = new GELU();
  testUnSquashWithHint(gelu, [
    // Test zero activation
    { activation: 0, hint: -10, expected: -10 },
    // Test positive activations
    { activation: gelu.squash(1), hint: 1, expected: 1 },
    { activation: gelu.squash(2), hint: 2, expected: 2 },
    { activation: gelu.squash(3), hint: 3, expected: 3 },
    // Test negative activations
    { activation: gelu.squash(-1), hint: -1, expected: -1 },
    { activation: gelu.squash(-2), hint: -2, expected: -2 },
    { activation: gelu.squash(-3), hint: -3, expected: -3 },
    // Test with hint far from expected
    { activation: gelu.squash(0.5), hint: 10, expected: 0.5 },
    // Test very small activations
    { activation: 0.0001, hint: -5, expected: -5 },
    // Test very large activations
    { activation: gelu.squash(10), hint: 10, expected: 10 },
  ]);
});

// COS tests (cyclic function)
Deno.test("COS unSquash with hint", () => {
  const cos = new Cosine();
  testUnSquashWithHint(cos, [
    { activation: cos.squash(0), hint: 0, expected: 0 },
    {
      activation: cos.squash(Math.PI / 2),
      hint: Math.PI / 2,
      expected: Math.PI / 2,
    },
    { activation: cos.squash(Math.PI), hint: Math.PI, expected: Math.PI },
    {
      activation: cos.squash(3 * Math.PI / 2),
      hint: 3 * Math.PI / 2,
      expected: 3 * Math.PI / 2,
    },
    {
      activation: cos.squash(2 * Math.PI),
      hint: 2 * Math.PI,
      expected: 2 * Math.PI,
    },
    // Test with hint far from the expected value
    {
      activation: cos.squash(42),
      hint: 100,
      expected: 98.54866776461627, // This is the value closest to 100 that produces the same cosine as 42
      tolerance: 0.1,
    },
    // Test with negative hint
    {
      activation: cos.squash(42),
      hint: -100,
      expected: -98.54866, // This is the value closest to -100 that produces the same cosine as 42
      tolerance: 0.1,
    },
    // Test with activation at extremes
    { activation: 1, hint: 0, expected: 0 },
    { activation: -1, hint: Math.PI, expected: Math.PI },
  ]);
});

// SIN tests (cyclic function)
Deno.test("SIN unSquash with hint", () => {
  const sin = new SINE();
  testUnSquashWithHint(sin, [
    { activation: sin.squash(0), hint: 0, expected: 0 },
    {
      activation: sin.squash(Math.PI / 2),
      hint: Math.PI / 2,
      expected: Math.PI / 2,
    },
    { activation: sin.squash(Math.PI), hint: Math.PI, expected: Math.PI },
    {
      activation: sin.squash(3 * Math.PI / 2),
      hint: 3 * Math.PI / 2,
      expected: 3 * Math.PI / 2,
    },
    {
      activation: sin.squash(2 * Math.PI),
      hint: 2 * Math.PI,
      expected: 2 * Math.PI,
    },
    // Test with hint far from the expected value
    {
      activation: sin.squash(42),
      hint: 100,
      expected: 99.3716694115407, // This is the value closest to 100 that produces the same sine as 42
      tolerance: 0.1,
    },
    // Test with negative hint
    {
      activation: sin.squash(42),
      hint: -100,
      expected: -101.689, // This is the value closest to -100 that produces the same sine as 42
      tolerance: 0.1,
    },
    // Test with activation at extremes
    { activation: 1, hint: Math.PI / 2, expected: Math.PI / 2 },
    { activation: -1, hint: -Math.PI / 2, expected: -Math.PI / 2 },
  ]);
});

// TAN tests (cyclic function)
Deno.test("TAN unSquash with hint", () => {
  const tan = new TAN();
  testUnSquashWithHint(tan, [
    { activation: tan.squash(0), hint: 0, expected: 0 },
    {
      activation: tan.squash(Math.PI / 4),
      hint: Math.PI / 4,
      expected: Math.PI / 4,
    },
    // Test with hint far from the expected value
    {
      activation: tan.squash(42),
      hint: 100,
      expected: 42 + Math.round((100 - 42) / Math.PI) * Math.PI, // Closest value to 100 that produces the same tangent as 42
      tolerance: 0.1,
    },
    // Test with negative hint
    {
      activation: tan.squash(42),
      hint: -100,
      expected: 42 + Math.round((-100 - 42) / Math.PI) * Math.PI, // Closest value to -100 that produces the same tangent as 42
      tolerance: 0.1,
    },
  ]);
});

// TANH tests
Deno.test("TANH unSquash with hint", () => {
  const tanh = new TANH();
  testUnSquashWithHint(tanh, [
    { activation: tanh.squash(0), hint: 0, expected: 0 },
    { activation: tanh.squash(1), hint: 1, expected: 1 },
    { activation: tanh.squash(-1), hint: -1, expected: -1 },
    { activation: tanh.squash(0.5), hint: 0.5, expected: 0.5 },
    // Test with hint far from expected
    { activation: tanh.squash(0.5), hint: 10, expected: 0.5 },
    // Test with activation at extremes
    { activation: 0.999, hint: 5, expected: 3.8002011672502 }, // Actual value that produces 0.999
    { activation: -0.999, hint: -5, expected: -3.8002011672502 }, // Actual value that produces -0.999
  ]);
});

// SIGMOID tests
Deno.test("SIGMOID unSquash with hint", () => {
  const sigmoid = new LOGISTIC();
  testUnSquashWithHint(sigmoid, [
    { activation: sigmoid.squash(0), hint: 0, expected: 0 },
    { activation: sigmoid.squash(1), hint: 1, expected: 1 },
    { activation: sigmoid.squash(-1), hint: -1, expected: -1 },
    { activation: sigmoid.squash(0.5), hint: 0.5, expected: 0.5 },
    // Test with hint far from expected
    { activation: sigmoid.squash(0.5), hint: 10, expected: 0.5 },
    // Test with activation at extremes
    { activation: 0.999, hint: 10, expected: 6.906754778648553 }, // Actual value that produces 0.999
    { activation: 0.001, hint: -10, expected: -6.906754778648553 }, // Actual value that produces 0.001
  ]);
});

// RELU tests
Deno.test("RELU unSquash with hint", () => {
  const relu = new RELU();
  testUnSquashWithHint(relu, [
    { activation: relu.squash(0), hint: 0, expected: 0 },
    { activation: relu.squash(1), hint: 1, expected: 1 },
    { activation: relu.squash(5), hint: 5, expected: 5 },
    // Test negative hint with zero activation
    // For RELU, any negative input produces zero activation
    // So with a negative hint and zero activation, we expect the hint value
    { activation: relu.squash(0), hint: -1, expected: -1 },
    // Test with large values
    { activation: relu.squash(100), hint: 100, expected: 100 },
  ]);
});

// LEAKY_RELU tests
Deno.test("LEAKY_RELU unSquash with hint", () => {
  const leakyRelu = new LeakyReLU();
  testUnSquashWithHint(leakyRelu, [
    { activation: leakyRelu.squash(0), hint: 0, expected: 0 },
    { activation: leakyRelu.squash(1), hint: 1, expected: 1 },
    { activation: leakyRelu.squash(5), hint: 5, expected: 5 },
    { activation: leakyRelu.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: leakyRelu.squash(100), hint: 100, expected: 100 },
    { activation: leakyRelu.squash(-100), hint: -100, expected: -100 },
  ]);
});

// ELU tests
Deno.test("ELU unSquash with hint", () => {
  const elu = new ELU();
  testUnSquashWithHint(elu, [
    { activation: elu.squash(0), hint: 0, expected: 0 },
    { activation: elu.squash(1), hint: 1, expected: 1 },
    { activation: elu.squash(5), hint: 5, expected: 5 },
    { activation: elu.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: elu.squash(100), hint: 100, expected: 100 },
    // Test with very negative values
    { activation: -0.999, hint: -10, expected: -6.907755278982136 }, // Actual value that produces -0.999
  ]);
});

// SWISH tests
Deno.test("SWISH unSquash with hint", () => {
  const swish = new Swish();
  testUnSquashWithHint(swish, [
    { activation: swish.squash(0), hint: 0, expected: 0 },
    { activation: swish.squash(1), hint: 1, expected: 1 },
    { activation: swish.squash(-1), hint: -1, expected: -1 },
    { activation: swish.squash(0.5), hint: 0.5, expected: 0.5 },
    // Test with large values
    { activation: swish.squash(10), hint: 10, expected: 10 },
    { activation: swish.squash(-10), hint: -10, expected: -10 },
  ]);
});

// MISH tests
Deno.test("MISH unSquash with hint", () => {
  const mish = new Mish();
  testUnSquashWithHint(mish, [
    { activation: mish.squash(0), hint: 0, expected: 0 },
    { activation: mish.squash(1), hint: 1, expected: 1 },
    { activation: mish.squash(-1), hint: -1, expected: -1 },
    { activation: mish.squash(0.5), hint: 0.5, expected: 0.5 },
    // Test with large values
    { activation: mish.squash(10), hint: 10, expected: 10 },
    { activation: mish.squash(-10), hint: -10, expected: -10 },
  ]);
});

// SOFTPLUS tests
Deno.test("SOFTPLUS unSquash with hint", () => {
  const softplus = new Softplus();
  testUnSquashWithHint(softplus, [
    { activation: softplus.squash(0), hint: 0, expected: 0 },
    { activation: softplus.squash(1), hint: 1, expected: 1 },
    { activation: softplus.squash(-1), hint: -1, expected: -1 },
    { activation: softplus.squash(0.5), hint: 0.5, expected: 0.5 },
    // Test with large values
    { activation: softplus.squash(10), hint: 10, expected: 10 },
    { activation: softplus.squash(-10), hint: -10, expected: -10 },
  ]);
});

// ReLU6 tests
Deno.test("ReLU6 unSquash with hint", () => {
  const relu6 = new ReLU6();
  testUnSquashWithHint(relu6, [
    { activation: relu6.squash(0), hint: 0, expected: 0 },
    { activation: relu6.squash(1), hint: 1, expected: 1 },
    { activation: relu6.squash(5), hint: 5, expected: 5 },
    { activation: relu6.squash(6), hint: 6, expected: 6 },
    // Test with hint above 6
    { activation: relu6.squash(6), hint: 10, expected: 10 }, // For ReLU6, any input >= 6 produces 6
    // Test negative hint with zero activation
    { activation: relu6.squash(0), hint: -1, expected: -1 },
  ]);
});

// SELU tests
Deno.test("SELU unSquash with hint", () => {
  const selu = new SELU();
  testUnSquashWithHint(selu, [
    { activation: selu.squash(0), hint: 0, expected: 0 },
    { activation: selu.squash(1), hint: 1, expected: 1 },
    { activation: selu.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: selu.squash(10), hint: 10, expected: 10 },
    // Test with very negative values
    { activation: selu.squash(-10), hint: -10, expected: -10 },
  ]);
});

// STEP tests
Deno.test("STEP unSquash with hint", () => {
  const step = new STEP();
  testUnSquashWithHint(step, [
    { activation: step.squash(0), hint: 0, expected: 0 },
    { activation: step.squash(1), hint: 1, expected: 1 },
    { activation: step.squash(-1), hint: -1, expected: -1 },
    // Test with hint at threshold
    { activation: 0, hint: -1, expected: -1 }, // STEP(-1) = 0
    { activation: 1, hint: 1, expected: 1 }, // STEP(1) = 1
  ]);
});

// ABSOLUTE tests
Deno.test("ABSOLUTE unSquash with hint", () => {
  const absolute = new ABSOLUTE();
  testUnSquashWithHint(absolute, [
    { activation: absolute.squash(0), hint: 0, expected: 0 },
    { activation: absolute.squash(1), hint: 1, expected: 1 },
    { activation: absolute.squash(-1), hint: -1, expected: -1 },
    // Test with hint of opposite sign
    { activation: absolute.squash(1), hint: -1, expected: -1 },
    { activation: absolute.squash(-1), hint: 1, expected: 1 },
  ]);
});

// ArcTan tests
Deno.test("ArcTan unSquash with hint", () => {
  const arctan = new ArcTan();
  testUnSquashWithHint(arctan, [
    { activation: arctan.squash(0), hint: 0, expected: 0 },
    { activation: arctan.squash(1), hint: 1, expected: 1 },
    { activation: arctan.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: arctan.squash(10), hint: 10, expected: 10 },
    { activation: arctan.squash(-10), hint: -10, expected: -10 },
  ]);
});

// BIPOLAR tests
Deno.test("BIPOLAR unSquash with hint", () => {
  const bipolar = new BIPOLAR();
  testUnSquashWithHint(bipolar, [
    { activation: bipolar.squash(0), hint: 0, expected: 0 },
    { activation: bipolar.squash(1), hint: 1, expected: 1 },
    { activation: bipolar.squash(-1), hint: -1, expected: -1 },
    // Test with hint of opposite sign
    { activation: -1, hint: -1, expected: -1 }, // BIPOLAR(-1) = -1
    { activation: 1, hint: 1, expected: 1 }, // BIPOLAR(1) = 1
  ]);
});

// COMPLEMENT tests
Deno.test("COMPLEMENT unSquash with hint", () => {
  const complement = new COMPLEMENT();
  testUnSquashWithHint(complement, [
    { activation: complement.squash(0), hint: 0, expected: 0 },
    { activation: complement.squash(1), hint: 1, expected: 1 },
    // Test with hint at complement
    { activation: 0, hint: 1, expected: 1 },
    { activation: 1, hint: 0, expected: 0 },
  ]);
});

// GAUSSIAN tests
Deno.test("GAUSSIAN unSquash with hint", () => {
  const gaussian = new GAUSSIAN();
  testUnSquashWithHint(gaussian, [
    { activation: gaussian.squash(0), hint: 0, expected: 0 },
    { activation: gaussian.squash(1), hint: 1, expected: 1 },
    { activation: gaussian.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: gaussian.squash(3), hint: 3, expected: 3 },
    { activation: gaussian.squash(-3), hint: -3, expected: -3 },
  ]);
});

// HARD_TANH tests
Deno.test("HARD_TANH unSquash with hint", () => {
  const hardTanh = new HARD_TANH();
  testUnSquashWithHint(hardTanh, [
    { activation: hardTanh.squash(0), hint: 0, expected: 0 },
    { activation: hardTanh.squash(1), hint: 1, expected: 1 },
    { activation: hardTanh.squash(-1), hint: -1, expected: -1 },
    // Test with values outside range
    { activation: 1, hint: 2, expected: 1 },
    { activation: -1, hint: -2, expected: -1 },
  ]);
});

// IDENTITY tests
Deno.test("IDENTITY unSquash with hint", () => {
  const identity = new IDENTITY();
  testUnSquashWithHint(identity, [
    { activation: identity.squash(0), hint: 0, expected: 0 },
    { activation: identity.squash(1), hint: 1, expected: 1 },
    { activation: identity.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: identity.squash(100), hint: 100, expected: 100 },
    { activation: identity.squash(-100), hint: -100, expected: -100 },
  ]);
});

// SOFTSIGN tests
Deno.test("SOFTSIGN unSquash with hint", () => {
  const softsign = new SOFTSIGN();
  testUnSquashWithHint(softsign, [
    { activation: softsign.squash(0), hint: 0, expected: 0 },
    { activation: softsign.squash(1), hint: 1, expected: 1 },
    { activation: softsign.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: softsign.squash(10), hint: 10, expected: 10 },
    { activation: softsign.squash(-10), hint: -10, expected: -10 },
  ]);
});

// LogSigmoid tests
Deno.test("LogSigmoid unSquash with hint", () => {
  const logSigmoid = new LogSigmoid();
  testUnSquashWithHint(logSigmoid, [
    { activation: logSigmoid.squash(0), hint: 0, expected: 0 },
    { activation: logSigmoid.squash(1), hint: 1, expected: 1 },
    { activation: logSigmoid.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: logSigmoid.squash(10), hint: 10, expected: 10 },
    { activation: logSigmoid.squash(-10), hint: -10, expected: -10 },
  ]);
});

// ISRU tests
Deno.test("ISRU unSquash with hint", () => {
  const isru = new ISRU();
  testUnSquashWithHint(isru, [
    { activation: isru.squash(0), hint: 0, expected: 0 },
    { activation: isru.squash(1), hint: 1, expected: 1 },
    { activation: isru.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: isru.squash(10), hint: 10, expected: 10 },
    { activation: isru.squash(-10), hint: -10, expected: -10 },
  ]);
});

// BIPOLAR_SIGMOID tests
Deno.test("BIPOLAR_SIGMOID unSquash with hint", () => {
  const bipolarSigmoid = new BIPOLAR_SIGMOID();
  testUnSquashWithHint(bipolarSigmoid, [
    { activation: bipolarSigmoid.squash(0), hint: 0, expected: 0 },
    { activation: bipolarSigmoid.squash(1), hint: 1, expected: 1 },
    { activation: bipolarSigmoid.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: bipolarSigmoid.squash(10), hint: 10, expected: 10 },
    { activation: bipolarSigmoid.squash(-10), hint: -10, expected: -10 },
  ]);
});

// Cube tests
Deno.test("Cube unSquash with hint", () => {
  const cube = new Cube();
  testUnSquashWithHint(cube, [
    { activation: cube.squash(0), hint: 0, expected: 0 },
    { activation: cube.squash(1), hint: 1, expected: 1 },
    { activation: cube.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: cube.squash(10), hint: 10, expected: 10 },
    { activation: cube.squash(-10), hint: -10, expected: -10 },
  ]);
});

// Exponential tests
Deno.test("Exponential unSquash with hint", () => {
  const exponential = new Exponential();
  testUnSquashWithHint(exponential, [
    { activation: exponential.squash(0), hint: 0, expected: 0 },
    { activation: exponential.squash(1), hint: 1, expected: 1 },
    // Test with large values
    { activation: exponential.squash(10), hint: 10, expected: 10 },
  ]);
});

// BENT_IDENTITY tests
Deno.test("BENT_IDENTITY unSquash with hint", () => {
  const bentIdentity = new BENT_IDENTITY();
  testUnSquashWithHint(bentIdentity, [
    { activation: bentIdentity.squash(0), hint: 0, expected: 0 },
    { activation: bentIdentity.squash(1), hint: 1, expected: 1 },
    { activation: bentIdentity.squash(-1), hint: -1, expected: -1 },
    // Test with large values
    { activation: bentIdentity.squash(10), hint: 10, expected: 10 },
    { activation: bentIdentity.squash(-10), hint: -10, expected: -10 },
  ]);
});
