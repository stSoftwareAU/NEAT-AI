import { assert } from "@std/assert";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

Deno.test("optimization/LearningRateRandomization - should randomize strategy when not specified", () => {
  // Test that different calls can produce different strategies (with high probability)
  const strategies = new Set<string>();

  // Run multiple times to catch randomization
  for (let i = 0; i < 20; i++) {
    const config = createBackPropagationConfig({});
    strategies.add(config.learningRateStrategy);
  }

  // Should have multiple different strategies (very high probability with 20 samples)
  assert(
    strategies.size > 1,
    `Expected multiple strategies from randomization, got: ${
      Array.from(strategies).join(", ")
    }`,
  );

  console.log(
    `✅ Randomized strategies found: ${Array.from(strategies).join(", ")}`,
  );
});

Deno.test("optimization/LearningRateRandomization - should respect explicit strategy", () => {
  // Test that explicit strategy overrides randomization
  const config = createBackPropagationConfig({
    learningRateStrategy: "adaptive",
  });

  assert(
    config.learningRateStrategy === "adaptive",
    `Expected 'adaptive' strategy, got: ${config.learningRateStrategy}`,
  );

  console.log("✅ Explicit strategy respected");
});

Deno.test("optimization/LearningRateRandomization - should use fixed when learningRate is set", () => {
  // Test that setting learningRate forces fixed strategy
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

  console.log("✅ Fixed strategy used when learningRate is explicitly set");
});

Deno.test("optimization/LearningRateRandomization - should have reasonable distribution", () => {
  // Test that the randomization has reasonable distribution
  const counts = { decay: 0, adaptive: 0, fixed: 0 };

  // Sample 100 times
  for (let i = 0; i < 100; i++) {
    const config = createBackPropagationConfig({});
    counts[config.learningRateStrategy as keyof typeof counts]++;
  }

  console.log(
    `Distribution: decay=${counts.decay}, adaptive=${counts.adaptive}, fixed=${counts.fixed}`,
  );

  // With 40% decay, 30% adaptive, 30% fixed, we should see reasonable distribution
  // Allow some variance but expect all strategies to appear
  assert(
    counts.decay > 10,
    "Should have reasonable number of decay strategies",
  );
  assert(
    counts.adaptive > 5,
    "Should have reasonable number of adaptive strategies",
  );
  assert(counts.fixed > 5, "Should have reasonable number of fixed strategies");

  console.log("✅ Randomization has reasonable distribution");
});
