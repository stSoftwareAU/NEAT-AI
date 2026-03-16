import { assert, assertAlmostEquals } from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";

Deno.test("optimization/AdaptiveLearningRate - decay strategy produces monotonically decreasing rates", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "decay",
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
  });

  const rates = [];
  for (let i = 0; i < 10; i++) {
    rates.push(calculateLearningRate(config, i));
  }

  // Every successive rate should be smaller
  for (let i = 1; i < rates.length; i++) {
    assert(
      rates[i] < rates[i - 1],
      `Rate at iteration ${i} (${rates[i]}) should be less than at ${i - 1} (${
        rates[i - 1]
      })`,
    );
  }

  // First rate should be the initial learning rate
  assertAlmostEquals(rates[0], 0.1, 1e-9);

  // Rate at iteration 1 should be initial * decay
  assertAlmostEquals(rates[1], 0.09, 1e-9);
});

Deno.test("optimization/AdaptiveLearningRate - fixed strategy returns constant rate across iterations", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "fixed",
    learningRate: 0.1,
  });

  // All iterations should produce the same rate
  for (let i = 0; i < 10; i++) {
    const rate = calculateLearningRate(config, i);
    assertAlmostEquals(
      rate,
      0.1,
      1e-12,
      `Fixed rate at iteration ${i} should be 0.1, got ${rate}`,
    );
  }
});
