import { assertAlmostEquals } from "@std/assert";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { limitWeight } from "../../src/propagate/Weight.ts";

Deno.test("maximumWeightAdjustmentScale", () => {
  const config = createBackPropagationConfig({
    maximumWeightAdjustmentScale: 0.2,
    learningRate: 1,
  });
  console.info(config);
  const weight = limitWeight(10, 0.5, config);

  assertAlmostEquals(0.7, weight, 0.001, `Weight: ${weight.toFixed(3)}`);
  const weight2 = limitWeight(10, -0.5, config);

  assertAlmostEquals(-0.3, weight2, 0.001, `Weight: ${weight.toFixed(3)}`);
});

Deno.test("maximumWeightAdjustmentScaleV2", () => {
  const config = createBackPropagationConfig({
    maximumWeightAdjustmentScale: 0.2,
    learningRate: 1,
  });
  console.info(config);
  const weight = limitWeight(500_000, 0.5, config);
  assertAlmostEquals(0.7, weight, 0.001, `Weight: ${weight.toFixed(3)}`);
});

Deno.test("limitWeightScale", () => {
  const config = createBackPropagationConfig({
    limitWeightScale: 20,
    maximumWeightAdjustmentScale: 10,
    learningRate: 1,
  });
  console.info(config);
  const weight = limitWeight(21, 11, config);

  assertAlmostEquals(20, weight, 0.001, `Weight: ${weight.toFixed(1)}`);
  const weight2 = limitWeight(-19, -18, config);

  assertAlmostEquals(-19, weight2, 0.001, `Weight: ${weight2.toFixed(1)}`);
  const weight3 = limitWeight(-23, -8, config);

  assertAlmostEquals(-18, weight3, 0.001, `Weight: ${weight3.toFixed(1)}`);
});
