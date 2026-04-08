/**
 * Issue #2219: Verify that named constants for backpropagation magic numbers
 * are correctly exported and used as defaults in configuration creation.
 */
import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  COORDINATION_FACTOR,
  createBackPropagationConfig,
  DEFAULT_BIAS_LIMIT_SCALE,
  DEFAULT_WEIGHT_LIMIT_SCALE,
  ERROR_IMPROVEMENT_THRESHOLD,
  ERROR_STAGNATION_THRESHOLD,
  IMPROVEMENT_BOOST_FACTOR,
  LEARNING_RATE_DECAY_FACTOR,
  MAX_RANDOM_GENERATIONS,
  MIN_ERROR_ADJUSTMENT,
  STAGNATION_BOOST_FACTOR,
} from "@propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// Verify constant values match documented defaults
// ---------------------------------------------------------------------------

Deno.test("BackPropConstants - MAX_RANDOM_GENERATIONS is 10", () => {
  assertEquals(MAX_RANDOM_GENERATIONS, 10);
});

Deno.test("BackPropConstants - DEFAULT_BIAS_LIMIT_SCALE is 10_000", () => {
  assertEquals(DEFAULT_BIAS_LIMIT_SCALE, 10_000);
});

Deno.test("BackPropConstants - DEFAULT_WEIGHT_LIMIT_SCALE is 100_000", () => {
  assertEquals(DEFAULT_WEIGHT_LIMIT_SCALE, 100_000);
});

Deno.test("BackPropConstants - LEARNING_RATE_DECAY_FACTOR is 0.95", () => {
  assertAlmostEquals(LEARNING_RATE_DECAY_FACTOR, 0.95, 1e-10);
});

Deno.test("BackPropConstants - COORDINATION_FACTOR is 0.2", () => {
  assertAlmostEquals(COORDINATION_FACTOR, 0.2, 1e-10);
});

Deno.test("BackPropConstants - ERROR_IMPROVEMENT_THRESHOLD is 0.95", () => {
  assertAlmostEquals(ERROR_IMPROVEMENT_THRESHOLD, 0.95, 1e-10);
});

Deno.test("BackPropConstants - ERROR_STAGNATION_THRESHOLD is 1.0", () => {
  assertAlmostEquals(ERROR_STAGNATION_THRESHOLD, 1.0, 1e-10);
});

Deno.test("BackPropConstants - IMPROVEMENT_BOOST_FACTOR is 1.1", () => {
  assertAlmostEquals(IMPROVEMENT_BOOST_FACTOR, 1.1, 1e-10);
});

Deno.test("BackPropConstants - STAGNATION_BOOST_FACTOR is 1.3", () => {
  assertAlmostEquals(STAGNATION_BOOST_FACTOR, 1.3, 1e-10);
});

Deno.test("BackPropConstants - MIN_ERROR_ADJUSTMENT is 0.5", () => {
  assertAlmostEquals(MIN_ERROR_ADJUSTMENT, 0.5, 1e-10);
});

// ---------------------------------------------------------------------------
// Verify config defaults use the named constants
// ---------------------------------------------------------------------------

Deno.test("BackPropConstants - default limitBiasScale uses DEFAULT_BIAS_LIMIT_SCALE", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.limitBiasScale, DEFAULT_BIAS_LIMIT_SCALE);
});

Deno.test("BackPropConstants - default limitWeightScale uses DEFAULT_WEIGHT_LIMIT_SCALE", () => {
  const config = createBackPropagationConfig();
  assertEquals(config.limitWeightScale, DEFAULT_WEIGHT_LIMIT_SCALE);
});

Deno.test("BackPropConstants - default learningRateDecay uses LEARNING_RATE_DECAY_FACTOR", () => {
  const config = createBackPropagationConfig();
  assertAlmostEquals(
    config.learningRateDecay,
    LEARNING_RATE_DECAY_FACTOR,
    1e-10,
  );
});

Deno.test("BackPropConstants - default biasWeightCoordinationFactor uses COORDINATION_FACTOR", () => {
  const config = createBackPropagationConfig();
  assertAlmostEquals(
    config.biasWeightCoordinationFactor,
    COORDINATION_FACTOR,
    1e-10,
  );
});

Deno.test("BackPropConstants - default generations within MAX_RANDOM_GENERATIONS range", () => {
  // Run multiple times to verify the random generation stays within bounds
  for (let i = 0; i < 50; i++) {
    const config = createBackPropagationConfig();
    assertEquals(config.generations >= 1, true, "Generations must be >= 1");
    assertEquals(
      config.generations <= MAX_RANDOM_GENERATIONS,
      true,
      `Generations ${config.generations} must be <= ${MAX_RANDOM_GENERATIONS}`,
    );
  }
});
