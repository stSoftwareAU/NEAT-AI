import { assert, assertEquals } from "@std/assert";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";

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

  assertEquals(config.learningRateStrategy, "adaptive");
});

Deno.test("optimization/LearningRateRandomization - uses fixed when learningRate is set", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.05,
  });

  assertEquals(config.learningRateStrategy, "fixed");
  assertEquals(config.learningRate, 0.05);
});

Deno.test("optimization/LearningRateRandomization - all four strategies appear in random selection", () => {
  const counts: Record<string, number> = {};

  // Sample 200 times - enough for all four strategies to appear reliably
  for (let i = 0; i < 200; i++) {
    const config = createBackPropagationConfig({});
    const strategy = config.learningRateStrategy;
    counts[strategy] = (counts[strategy] ?? 0) + 1;
  }

  // Each of the four strategies should appear at least a few times
  assert(
    (counts["decay"] ?? 0) > 5,
    `Expected decay to appear in random selection, got ${counts["decay"] ?? 0}`,
  );
  assert(
    (counts["adaptive"] ?? 0) > 5,
    `Expected adaptive to appear in random selection, got ${
      counts["adaptive"] ?? 0
    }`,
  );
  assert(
    (counts["fixed"] ?? 0) > 5,
    `Expected fixed to appear in random selection, got ${counts["fixed"] ?? 0}`,
  );
  assert(
    (counts["warm_restart"] ?? 0) > 5,
    `Expected warm_restart to appear in random selection, got ${
      counts["warm_restart"] ?? 0
    }`,
  );
});
