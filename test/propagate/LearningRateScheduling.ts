/**
 * Tests for learning rate scheduling improvements (Issue #1437).
 *
 * Verifies:
 * - Sensible default learning rate (0.01) instead of random initialisation
 * - Warm restart strategy for escaping local minima
 * - Default learning rate is predictable and effective
 *
 * Closes #1437
 */
import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertGreaterOrEqual,
  assertLessOrEqual,
} from "@std/assert";
import {
  calculateLearningRate,
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// Sensible default learning rate
// ---------------------------------------------------------------------------

Deno.test("LearningRateScheduling - default learning rate is 0.01", () => {
  // Issue #1437: The default learning rate should be a sensible fixed value
  // (0.01) instead of random()^3 which is heavily biased towards tiny values.
  const config = createBackPropagationConfig();
  assertAlmostEquals(
    config.learningRate,
    0.01,
    1e-9,
    "Default learning rate should be 0.01, not random",
  );
});

Deno.test("LearningRateScheduling - default is consistent across calls", () => {
  // Issue #1437: Without explicit learningRate, the default should be
  // deterministic (0.01), not random.
  const configs = Array.from(
    { length: 10 },
    () => createBackPropagationConfig(),
  );

  for (const config of configs) {
    assertAlmostEquals(
      config.learningRate,
      0.01,
      1e-9,
      "Default learning rate should always be 0.01",
    );
  }
});

Deno.test("LearningRateScheduling - explicit learningRate still respected", () => {
  const config = createBackPropagationConfig({ learningRate: 0.05 });
  assertAlmostEquals(config.learningRate, 0.05, 1e-9);
});

// ---------------------------------------------------------------------------
// Warm restart strategy
// ---------------------------------------------------------------------------

Deno.test("LearningRateScheduling - warm_restart is a valid strategy", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "warm_restart",
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
  });
  assertEquals(config.learningRateStrategy, "warm_restart");
});

Deno.test("LearningRateScheduling - warm_restart decays then resets", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "warm_restart",
    initialLearningRate: 0.1,
    learningRateDecay: 0.5,
    warmRestartPeriod: 5,
  });

  // At iteration 0 (start of first period), rate should be at initialLearningRate
  const lr0 = calculateLearningRate(config, 0);
  assertAlmostEquals(lr0, 0.1, 1e-9, "Start of first period");

  // Rate should decay within the period
  const lr2 = calculateLearningRate(config, 2);
  assertGreater(lr0, lr2, "Should decay within period");

  // At iteration 5 (start of second period), rate resets to initialLearningRate
  const lr5 = calculateLearningRate(config, 5);
  assertAlmostEquals(lr5, 0.1, 1e-9, "Should reset at period boundary");

  // Decays again after restart
  const lr7 = calculateLearningRate(config, 7);
  assertGreater(lr5, lr7, "Should decay again after restart");
});

Deno.test("LearningRateScheduling - warm_restart with default period", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "warm_restart",
    initialLearningRate: 0.1,
    learningRateDecay: 0.9,
  });

  // Default period is 10
  assertEquals(config.warmRestartPeriod, 10);

  // Should reset at iteration 10
  const lr0 = calculateLearningRate(config, 0);
  const lr10 = calculateLearningRate(config, 10);
  assertAlmostEquals(
    lr0,
    lr10,
    1e-9,
    "Should reset at default period boundary",
  );
});

Deno.test("LearningRateScheduling - warm_restart period is clamped", () => {
  // Period must be at least 2
  const config = createBackPropagationConfig({
    learningRateStrategy: "warm_restart",
    warmRestartPeriod: 0,
  });
  assertGreaterOrEqual(config.warmRestartPeriod, 2);
});

Deno.test("LearningRateScheduling - warm_restart rate stays positive", () => {
  const config = createBackPropagationConfig({
    learningRateStrategy: "warm_restart",
    initialLearningRate: 0.1,
    learningRateDecay: 0.1,
    warmRestartPeriod: 5,
  });

  for (let i = 0; i < 30; i++) {
    const lr = calculateLearningRate(config, i);
    assertGreater(lr, 0, `Rate at iteration ${i} should be positive`);
    assertLessOrEqual(
      lr,
      0.1,
      `Rate at iteration ${i} should not exceed initial`,
    );
  }
});

// ---------------------------------------------------------------------------
// Strategy selection defaults
// ---------------------------------------------------------------------------

Deno.test("LearningRateScheduling - warm_restart included in random strategy pool", () => {
  // When no strategy or learning rate is specified, the random selection
  // should include warm_restart as a possible strategy.
  const strategies = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const config = createBackPropagationConfig({});
    strategies.add(config.learningRateStrategy);
  }

  // warm_restart should be a possible outcome
  assertEquals(
    strategies.has("warm_restart"),
    true,
    `Expected warm_restart in random pool, got: ${
      Array.from(strategies).join(", ")
    }`,
  );
});

Deno.test("LearningRateScheduling - explicit strategy overrides default", () => {
  for (
    const strategy of ["fixed", "decay", "adaptive", "warm_restart"] as const
  ) {
    const config = createBackPropagationConfig({
      learningRateStrategy: strategy,
    });
    assertEquals(config.learningRateStrategy, strategy);
  }
});
