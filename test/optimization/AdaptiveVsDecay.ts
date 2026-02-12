import { assert } from "@std/assert";
import { calculateLearningRate } from "../../src/propagate/BackPropagation.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

Deno.test("optimization/AdaptiveVsDecay - should produce different learning rates than decay strategy", () => {
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

    console.log(
      `Iteration ${iteration}: decay=${decayRate.toFixed(6)}, adaptive=${
        adaptiveRate.toFixed(6)
      }`,
    );

    if (Math.abs(decayRate - adaptiveRate) > 0.0001) {
      differencesFound++;
    }
  }

  // The adaptive strategy should produce different results from decay
  assert(
    differencesFound > 0,
    `Adaptive and decay strategies should produce different learning rates. Found differences in ${differencesFound}/${iterations.length} iterations`,
  );

  console.log(
    `✅ Adaptive strategy is distinct from decay strategy (${differencesFound}/${iterations.length} iterations differ)`,
  );
});

Deno.test("optimization/AdaptiveVsDecay - adaptive responds to error feedback", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Without error feedback, adaptive uses slower decay (sqrt of decay rate)
  const rateWithoutFeedback = calculateLearningRate(config, 5);

  // With stagnation feedback, rate should be higher (boosted to escape plateau)
  const rateWithStagnation = calculateLearningRate(config, 5, {
    previousError: 0.5,
    currentError: 0.499,
  });

  // With improvement feedback, rate should be maintained/slightly boosted
  const rateWithImprovement = calculateLearningRate(config, 5, {
    previousError: 0.5,
    currentError: 0.3,
  });

  // Stagnation should produce a higher rate than improvement (to escape plateau)
  assert(
    rateWithStagnation > rateWithImprovement,
    `Stagnation rate (${rateWithStagnation}) should exceed improvement rate (${rateWithImprovement})`,
  );

  // All rates should be positive
  assert(rateWithoutFeedback > 0, "Rate without feedback should be positive");
  assert(rateWithStagnation > 0, "Rate with stagnation should be positive");
  assert(rateWithImprovement > 0, "Rate with improvement should be positive");
});
