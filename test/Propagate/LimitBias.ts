import { assertAlmostEquals } from "@std/assert";
import {
  createBackPropagationConfig,
  limitBias,
} from "../../src/propagate/BackPropagation.ts";

Deno.test("maximumBiasAdjustmentScale", () => {
  const config = createBackPropagationConfig({
    maximumBiasAdjustmentScale: 0.2,
    learningRate: 0.05,
  });

  const bias = limitBias(10, 0.5, config);

  assertAlmostEquals(0.7, bias, 0.001, `Bias: ${bias.toFixed(3)}`);
  const bias2 = limitBias(10, -0.5, config);

  assertAlmostEquals(-0.3, bias2, 0.001, `Bias: ${bias.toFixed(3)}`);
});

Deno.test("maximumBiasAdjustmentScaleV2", () => {
  const config = createBackPropagationConfig({
    limitBiasScale: 10000,
    learningRate: 0.02,
  });
  const bias = limitBias(-784335, 11, config);

  assertAlmostEquals(1, bias, 0.001, `Bias: ${bias.toFixed(3)}`);
});

Deno.test("limitBiasScale", () => {
  const config = createBackPropagationConfig({
    limitBiasScale: 20,
    maximumBiasAdjustmentScale: 10,
    learningRate: 1,
  });
  console.info(config);
  const bias = limitBias(21, 11, config);

  assertAlmostEquals(20, bias, 0.001, `Bias: ${bias.toFixed(1)}`);
  const bias2 = limitBias(-19, -18, config);

  assertAlmostEquals(-19, bias2, 0.001, `Bias: ${bias2.toFixed(1)}`);
  const bias3 = limitBias(-23, -8, config);

  assertAlmostEquals(-18, bias3, 0.001, `Bias: ${bias3.toFixed(1)}`);

  const bias4 = limitBias(-63.892, -760.8656, config);

  assertAlmostEquals(-751, bias4, 0.2, `Bias: ${bias4.toFixed(1)}`);
});
