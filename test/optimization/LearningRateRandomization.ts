import { assert } from "@std/assert";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

Deno.test("optimization/LearningRateRandomization - randomises strategy when not specified", () => {
  // Test that different calls can produce different strategies (with high probability)
  const strategies = new Set<string>();

  // Run multiple times to catch randomisation
  for (let i = 0; i < 20; i++) {
    const config = createBackPropagationConfig({});
    strategies.add(config.learningRateStrategy);
  }

  // Should have multiple different strategies (very high probability with 20 samples)
  assert(
    strategies.size > 1,
    `Expected multiple strategies from randomisation, got: ${
      Array.from(strategies).join(", ")
    }`,
  );
});

Deno.test("optimization/LearningRateRandomization - respects explicit strategy", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
  });

  assert(
    config.learningRateStrategy === "adaptive",
    `Expected 'adaptive' strategy, got: ${config.learningRateStrategy}`,
  );
});

Deno.test("optimization/LearningRateRandomization - uses fixed when learningRate is set", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.05,
  });

  assert(
    config.learningRateStrategy === "fixed",
    `Expected 'fixed' strategy when learningRate is set, got: ${config.learningRateStrategy}`,
  );
  assert(
    config.learningRate === 0.05,
    `Expected learningRate to be 0.05, got: ${config.learningRate}`,
  );
});

Deno.test("optimization/LearningRateRandomization - all strategies appear in random selection", () => {
  const counts: Record<string, number> = {};

  // Sample 100 times
  for (let i = 0; i < 100; i++) {
    const config = createBackPropagationConfig({});
    const strategy = config.learningRateStrategy;
    counts[strategy] = (counts[strategy] ?? 0) + 1;
  }

  // Each strategy should appear at least a few times
  assert(
    (counts["decay"] ?? 0) > 5,
    "Should have reasonable number of decay strategies",
  );
  assert(
    (counts["adaptive"] ?? 0) > 5,
    "Should have reasonable number of adaptive strategies",
  );
  assert(
    (counts["fixed"] ?? 0) > 5,
    "Should have reasonable number of fixed strategies",
  );
});
