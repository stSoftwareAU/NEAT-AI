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

Deno.test("optimization/AdaptiveVsDecay - adaptive should have oscillation pattern", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
    initialLearningRate: 0.1,
    learningRateDecay: 0.95,
  });

  // Test that adaptive strategy has the expected oscillation pattern
  const rates = [];
  for (let i = 0; i < 10; i++) {
    rates.push(calculateLearningRate(config, i));
  }

  // Check that rates are not monotonically decreasing (unlike decay)
  let isMonotonic = true;
  for (let i = 1; i < rates.length; i++) {
    if (rates[i] > rates[i - 1]) {
      isMonotonic = false;
      break;
    }
  }

  // Adaptive strategy should NOT be monotonically decreasing due to oscillation
  assert(
    !isMonotonic,
    "Adaptive strategy should not be monotonically decreasing due to oscillation pattern",
  );

  console.log(
    "✅ Adaptive strategy has oscillation pattern (not monotonically decreasing)",
  );
});
