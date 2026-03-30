/**
 * Test suite for parallel evaluation configuration (Issue #1862).
 *
 * Verifies that the ParallelEvaluationConfig is properly parsed,
 * defaults are applied, and CLI coercion works correctly.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { DEFAULT_PARALLEL_EVALUATION_CONFIG } from "@config/ParallelEvaluationConfig.ts";

Deno.test("ParallelEvaluationConfig - default values are sensible", () => {
  assertEquals(
    DEFAULT_PARALLEL_EVALUATION_CONFIG.maxConcurrentEvaluations,
    0,
  );
  assertEquals(DEFAULT_PARALLEL_EVALUATION_CONFIG.topologyGrouping, true);
});

Deno.test("ParallelEvaluationConfig - defaults applied when not set", () => {
  const config = createNeatConfig({});
  assertEquals(config.parallelEvaluation.maxConcurrentEvaluations, 0);
  assertEquals(config.parallelEvaluation.topologyGrouping, true);
});

Deno.test("ParallelEvaluationConfig - custom values override defaults", () => {
  const config = createNeatConfig({
    parallelEvaluation: {
      maxConcurrentEvaluations: 4,
      topologyGrouping: false,
    },
  });
  assertEquals(config.parallelEvaluation.maxConcurrentEvaluations, 4);
  assertEquals(config.parallelEvaluation.topologyGrouping, false);
});

Deno.test("ParallelEvaluationConfig - partial overrides merge with defaults", () => {
  const config = createNeatConfig({
    parallelEvaluation: { maxConcurrentEvaluations: 2 },
  });
  assertEquals(config.parallelEvaluation.maxConcurrentEvaluations, 2);
  assertEquals(
    config.parallelEvaluation.topologyGrouping,
    DEFAULT_PARALLEL_EVALUATION_CONFIG.topologyGrouping,
  );
});

Deno.test("ParallelEvaluationConfig - string values coerced from CLI", () => {
  const config = createNeatConfig({
    parallelEvaluation: {
      maxConcurrentEvaluations: "3" as unknown as number,
    },
  });
  assertEquals(config.parallelEvaluation.maxConcurrentEvaluations, 3);
});

Deno.test("ParallelEvaluationConfig - maxConcurrentEvaluations must be >= 0", () => {
  assertThrows(
    () =>
      createNeatConfig({
        parallelEvaluation: { maxConcurrentEvaluations: -1 },
      }),
    Error,
    "maxConcurrentEvaluations",
  );
});

Deno.test("ParallelEvaluationConfig - config frozen after creation", () => {
  const config = createNeatConfig({
    parallelEvaluation: { maxConcurrentEvaluations: 2 },
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
