import { assert, assertEquals } from "@std/assert";
import { computeAdaptivePopulationSize } from "@neat/AdaptivePopulationSizer.ts";
import { DEFAULT_ADAPTIVE_POPULATION_CONFIG } from "../../src/config/AdaptivePopulationConfig.ts";

const enabledConfig = {
  ...DEFAULT_ADAPTIVE_POPULATION_CONFIG,
  enabled: true,
};

Deno.test("AdaptivePopulationSizer - returns base size when disabled", () => {
  const size = computeAdaptivePopulationSize(
    50,
    50,
    5,
    false,
    DEFAULT_ADAPTIVE_POPULATION_CONFIG,
  );
  assertEquals(size, 50);
});

Deno.test("AdaptivePopulationSizer - grows on low diversity", () => {
  // 1 species out of 50 = diversity 0.02, which is below lowDiversityThreshold (0.3)
  const size = computeAdaptivePopulationSize(
    50,
    50,
    1,
    false,
    enabledConfig,
  );
  assert(size > 50, `Expected growth, got ${size}`);
});

Deno.test("AdaptivePopulationSizer - shrinks on high diversity with plateau", () => {
  // 45 species out of 50 = diversity 0.9, above highDiversityThreshold (0.8) AND on plateau
  const size = computeAdaptivePopulationSize(
    50,
    50,
    45,
    true,
    enabledConfig,
  );
  assert(size < 50, `Expected shrink, got ${size}`);
});

Deno.test("AdaptivePopulationSizer - no change for normal diversity", () => {
  // 15 species out of 50 = diversity 0.3, at the threshold boundary
  // diversity = 0.3 is not < lowDiversityThreshold (0.3), not > highDiversityThreshold (0.8)
  const size = computeAdaptivePopulationSize(
    50,
    50,
    15,
    false,
    enabledConfig,
  );
  assertEquals(size, 50);
});

Deno.test("AdaptivePopulationSizer - high diversity without plateau stays same", () => {
  // High diversity but not on plateau — no shrink
  const size = computeAdaptivePopulationSize(
    50,
    50,
    45,
    false,
    enabledConfig,
  );
  assertEquals(size, 50);
});

Deno.test("AdaptivePopulationSizer - respects maximum bound", () => {
  // Force growth but check it doesn't exceed max
  const size = computeAdaptivePopulationSize(
    50,
    100, // already at 2x base
    1,
    false,
    enabledConfig,
  );
  assert(size <= 100, `Expected capped at max ${100}, got ${size}`);
});

Deno.test("AdaptivePopulationSizer - respects minimum bound", () => {
  // Force shrink but check it doesn't go below min
  const size = computeAdaptivePopulationSize(
    50,
    26, // near the minimum (25)
    45,
    true,
    enabledConfig,
  );
  assert(size >= 25, `Expected at least 25, got ${size}`);
});

Deno.test("AdaptivePopulationSizer - adjustment rate controls step size", () => {
  const smallStepConfig = { ...enabledConfig, adjustmentRate: 0.05 };
  const largeStepConfig = { ...enabledConfig, adjustmentRate: 0.5 };

  // Both grow with low diversity
  const small = computeAdaptivePopulationSize(
    50,
    50,
    1,
    false,
    smallStepConfig,
  );
  const large = computeAdaptivePopulationSize(
    50,
    50,
    1,
    false,
    largeStepConfig,
  );

  assert(small > 50, "Small step should still grow");
  assert(
    large > small,
    `Large step (${large}) should grow more than small (${small})`,
  );
});
