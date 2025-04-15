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
  ]);
});

// COS tests (cyclic function)
Deno.test("COS unSquash with hint", () => {
  const cos = new Cosine();
  testUnSquashWithHint(cos, [
    // Basic cases
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
    // For cyclic functions like cosine, we expect unSquash to find the solution
    // closest to the hint that produces the given activation
    {
      activation: cos.squash(42),
      hint: 100,
      expected: 98.54866776461627, // This is the value closest to 100 that produces cos(42)
      tolerance: 0.1, // Increase tolerance for this case due to periodic nature
    },
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
    // For cyclic functions like sine, we expect unSquash to find the solution
    // closest to the hint that produces the given activation
    {
      activation: sin.squash(42),
      hint: 100,
      expected: 99.3716694115407, // This is the value closest to 100 that produces sin(42)
      tolerance: 0.1, // Increase tolerance for this case due to periodic nature
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
  ]);
});
