import { assertAlmostEquals } from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
} from "@propagate/BackPropagation.ts";

Deno.test("optimization/AdaptiveVsDecay - adaptive decays slower than pure decay at the same iteration", () => {
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

  // At iteration 0 both should equal the initial rate
  assertAlmostEquals(calculateLearningRate(configDecay, 0), 0.1, 1e-12);
  assertAlmostEquals(calculateLearningRate(configAdaptive, 0), 0.1, 1e-12);

  // Decay: rate = 0.1 * 0.95^i
  // Adaptive (no error feedback): rate = 0.1 * sqrt(0.95)^i
  // sqrt(0.95) ≈ 0.97468, so adaptive decays more slowly.
  const decayRate1 = calculateLearningRate(configDecay, 1);
  const adaptiveRate1 = calculateLearningRate(configAdaptive, 1);
  assertAlmostEquals(decayRate1, 0.1 * 0.95, 1e-9);
  assertAlmostEquals(adaptiveRate1, 0.1 * Math.sqrt(0.95), 1e-9);

  // At iteration 5 the gap widens
  const decayRate5 = calculateLearningRate(configDecay, 5);
  const adaptiveRate5 = calculateLearningRate(configAdaptive, 5);
  assertAlmostEquals(decayRate5, 0.1 * Math.pow(0.95, 5), 1e-9);
  assertAlmostEquals(adaptiveRate5, 0.1 * Math.pow(Math.sqrt(0.95), 5), 1e-9);
});
