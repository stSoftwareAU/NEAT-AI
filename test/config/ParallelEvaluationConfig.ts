/**
 * Test suite for parallel evaluation configuration (Issue #1862).
 *
 * Verifies that the ParallelEvaluationConfig is properly parsed,
 * defaults are applied, and CLI coercion works correctly.
 *
 * Issue #3566: `maxConcurrentEvaluations` was removed — it defaulted to 0,
 * which made the only branch reading it a no-op, and the #2245 fast/heavy
 * worker-pool split already reserves workers for training and discovery.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { DEFAULT_PARALLEL_EVALUATION_CONFIG } from "@config/ParallelEvaluationConfig.ts";

Deno.test("ParallelEvaluationConfig - default values are sensible", () => {
  assertEquals(DEFAULT_PARALLEL_EVALUATION_CONFIG.topologyGrouping, true);
});

Deno.test("ParallelEvaluationConfig - defaults applied when not set", () => {
  const config = createNeatConfig({});
  assertEquals(config.parallelEvaluation.topologyGrouping, true);
});

Deno.test("ParallelEvaluationConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    parallelEvaluation: { topologyGrouping: false },
  });
  assertEquals(config.parallelEvaluation.topologyGrouping, false);
});

Deno.test("ParallelEvaluationConfig - partial overrides merge with defaults", () => {
  const config = createNeatConfig({ parallelEvaluation: {} });
  assertEquals(
    config.parallelEvaluation.topologyGrouping,
    DEFAULT_PARALLEL_EVALUATION_CONFIG.topologyGrouping,
  );
});

Deno.test("ParallelEvaluationConfig - config frozen after creation", () => {
  const config = createNeatConfig({
    parallelEvaluation: { topologyGrouping: false },
  });
  assertThrows(
    () => {
      (config as Record<string, unknown>).parallelEvaluation = {};
    },
    TypeError,
    "Cannot assign",
  );
});

Deno.test("ParallelEvaluationConfig - topology grouping can be disabled", () => {
  const config = createNeatConfig({
    parallelEvaluation: { topologyGrouping: false },
  });
  assertEquals(config.parallelEvaluation.topologyGrouping, false);
});

Deno.test("ParallelEvaluationConfig - maxConcurrentEvaluations is gone (Issue #3566)", () => {
  assert(
    !("maxConcurrentEvaluations" in DEFAULT_PARALLEL_EVALUATION_CONFIG),
    "the removed option must not reappear in the defaults",
  );
  const config = createNeatConfig({
    parallelEvaluation: {
      maxConcurrentEvaluations: 2,
    } as unknown as Record<string, unknown>,
  });
  assert(
    !("maxConcurrentEvaluations" in config.parallelEvaluation),
    "an unknown override must not be carried into the parsed config",
  );
  assertEquals(config.parallelEvaluation.topologyGrouping, true);
});
