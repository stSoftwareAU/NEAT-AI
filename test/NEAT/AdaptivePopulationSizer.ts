import { assert, assertEquals } from "@std/assert";
import { computeAdaptivePopulationSize } from "@neat/AdaptivePopulationSizer.ts";
import { DEFAULT_ADAPTIVE_POPULATION_CONFIG } from "@config/AdaptivePopulationConfig.ts";

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

// Issue #2316: Worker-aware floor tests

Deno.test("AdaptivePopulationSizer - minCreaturesPerWorker default is 3", () => {
  assertEquals(DEFAULT_ADAPTIVE_POPULATION_CONFIG.minCreaturesPerWorker, 3);
});

Deno.test("AdaptivePopulationSizer - worker floor raises effective size", () => {
  // Simulate: base=50, 34 workers, minCreaturesPerWorker=3
  // Worker floor = 34 * 3 = 102
  // Adaptive sizer returns 50 (normal diversity, no change)
  const adaptiveSize = computeAdaptivePopulationSize(
    50,
    50,
    15, // normal diversity
    false,
    enabledConfig,
  );
  assertEquals(
    adaptiveSize,
    50,
    "Sizer should return base when diversity normal",
  );

  // Worker floor should raise it
  const workerCount = 34;
  const workerFloor = workerCount * enabledConfig.minCreaturesPerWorker;
  const effectiveSize = Math.max(adaptiveSize, workerFloor);
  assertEquals(effectiveSize, 102);
  assert(
    effectiveSize > adaptiveSize,
    "Worker floor should raise effective size above adaptive size",
  );
});

Deno.test("AdaptivePopulationSizer - worker floor has no effect with few workers", () => {
  // 5 workers * 3 = 15 floor, which is below base of 50
  const adaptiveSize = computeAdaptivePopulationSize(
    50,
    50,
    15,
    false,
    enabledConfig,
  );
  const workerCount = 5;
  const workerFloor = workerCount * enabledConfig.minCreaturesPerWorker;
  const effectiveSize = Math.max(adaptiveSize, workerFloor);
  assertEquals(effectiveSize, 50, "Worker floor should not reduce population");
});

Deno.test("AdaptivePopulationSizer - worker floor disabled when minCreaturesPerWorker is 0", () => {
  const noFloorConfig = { ...enabledConfig, minCreaturesPerWorker: 0 };
  // Even with 100 workers, floor is 0 so no effect
  const workerCount = 100;
  const workerFloor = workerCount * noFloorConfig.minCreaturesPerWorker;
  assertEquals(workerFloor, 0);
});

Deno.test("AdaptivePopulationSizer - growth combined with worker floor", () => {
  // Low diversity triggers growth, worker floor may further increase
  // base=50, 20 workers, minCreaturesPerWorker=3 → floor=60
  const adaptiveSize = computeAdaptivePopulationSize(
    50,
    50,
    1, // very low diversity, triggers growth
    false,
    enabledConfig,
  );
  // Growth: 50 + round(50 * 0.1) = 55
  assertEquals(adaptiveSize, 55);

  // Worker floor is higher: 20 * 3 = 60
  const workerCount = 20;
  const workerFloor = workerCount * enabledConfig.minCreaturesPerWorker;
  const effectiveSize = Math.max(adaptiveSize, workerFloor);
  assertEquals(effectiveSize, 60);
});

Deno.test("AdaptivePopulationSizer - successive growth across generations", () => {
  // Simulate multiple generations of low diversity
  let currentSize = 50;
  for (let gen = 0; gen < 5; gen++) {
    currentSize = computeAdaptivePopulationSize(
      50,
      currentSize,
      1, // low diversity each generation
      false,
      enabledConfig,
    );
  }
  // After 5 generations of growth (5 each time): 50 → 55 → 60 → 65 → 70 → 75
  assertEquals(currentSize, 75);
});

Deno.test("AdaptivePopulationSizer - growth capped at maxPopulationFraction", () => {
  // Simulate many generations of continuous growth — should cap at 2x base (100)
  let currentSize = 50;
  for (let gen = 0; gen < 20; gen++) {
    currentSize = computeAdaptivePopulationSize(
      50,
      currentSize,
      1,
      false,
      enabledConfig,
    );
  }
  assertEquals(currentSize, 100, "Growth should cap at 2x base population");
});

Deno.test("AdaptivePopulationSizer - shrink then stabilise", () => {
  // High diversity + plateau causes shrink; then diversity drops and stabilises
  let currentSize = 80;

  // Gen 1: high diversity + plateau → shrink
  currentSize = computeAdaptivePopulationSize(
    50,
    currentSize,
    72, // 72/80 = 0.9 > 0.8
    true,
    enabledConfig,
  );
  assertEquals(currentSize, 75, "Should shrink by 5 (10% of base 50)");

  // Gen 2: normal diversity, no plateau → stable
  currentSize = computeAdaptivePopulationSize(
    50,
    currentSize,
    30, // 30/75 = 0.4, within normal range
    false,
    enabledConfig,
  );
  assertEquals(currentSize, 75, "Should remain stable at 75");
});
