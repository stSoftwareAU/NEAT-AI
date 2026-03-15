import { assert } from "@std/assert";
import { calculateLearningRate } from "../../src/propagate/BackPropagation.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

Deno.test("optimization/AdaptiveVsDecay - adaptive produces different rates than decay", () => {
  const configDecay = createBackPropagationConfig({
    learningRateStrategy: "decay",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  const configAdaptive = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Test multiple iterations to ensure they produce different results
  const iterations = [0, 1, 2, 3, 4, 5];
  let differencesFound = 0;

  for (const iteration of iterations) {
    const decayRate = calculateLearningRate(configDecay, iteration);
    const adaptiveRate = calculateLearningRate(configAdaptive, iteration);

    if (Math.abs(decayRate - adaptiveRate) > 0.0001) {
      differencesFound++;
    }
  }

  // The adaptive strategy should produce different results from decay
  assert(
    differencesFound > 0,
    `Adaptive and decay strategies should produce different learning rates. Found differences in ${differencesFound}/${iterations.length} iterations`,
  );
});
