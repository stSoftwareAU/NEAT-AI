/**
 * Issue #2316 — Benchmark adaptive population sizing for worker utilisation.
 *
 * Evaluates the impact of adaptive population sizing on CPU utilisation
 * at production scale. Compares the overhead of the sizing computation
 * and validates that the worker-aware floor correctly scales with
 * thread counts matching production configurations.
 *
 * This benchmark measures:
 *   - Computation cost of `computeAdaptivePopulationSize` per generation
 *   - Worker-aware floor calculations across different thread counts
 *   - Successive generation sizing convergence behaviour
 *
 * Run with:
 *   deno bench --allow-read --allow-write --allow-env --allow-ffi bench/AdaptivePopulationSizing.ts
 */

import { computeAdaptivePopulationSize } from "@neat/AdaptivePopulationSizer.ts";
import { DEFAULT_ADAPTIVE_POPULATION_CONFIG } from "@config/AdaptivePopulationConfig.ts";

const enabledConfig = {
  ...DEFAULT_ADAPTIVE_POPULATION_CONFIG,
  enabled: true,
};

// ──────────────────────────────────────────────────────────────────
// Sizing computation overhead
// ──────────────────────────────────────────────────────────────────

Deno.bench(
  "computeAdaptivePopulationSize - disabled (passthrough)",
  { group: "adaptive-sizing-overhead" },
  () => {
    computeAdaptivePopulationSize(
      50,
      50,
      10,
      false,
      DEFAULT_ADAPTIVE_POPULATION_CONFIG,
    );
  },
);

Deno.bench(
  "computeAdaptivePopulationSize - enabled, normal diversity",
  { group: "adaptive-sizing-overhead" },
  () => {
    computeAdaptivePopulationSize(50, 50, 15, false, enabledConfig);
  },
);

Deno.bench(
  "computeAdaptivePopulationSize - enabled, low diversity (growth)",
  { group: "adaptive-sizing-overhead" },
  () => {
    computeAdaptivePopulationSize(50, 50, 1, false, enabledConfig);
  },
);

Deno.bench(
  "computeAdaptivePopulationSize - enabled, high diversity + plateau (shrink)",
  { group: "adaptive-sizing-overhead" },
  () => {
    computeAdaptivePopulationSize(50, 50, 45, true, enabledConfig);
  },
);

// ──────────────────────────────────────────────────────────────────
// Worker-aware floor at various scales
// ──────────────────────────────────────────────────────────────────

const threadScenarios = [
  { name: "8-core (10 threads)", threads: 10 },
  { name: "16-core (18 threads)", threads: 18 },
  { name: "32-core (34 threads)", threads: 34 },
  { name: "64-core (66 threads)", threads: 66 },
];

for (const scenario of threadScenarios) {
  Deno.bench(
    `worker-aware floor - ${scenario.name}`,
    { group: "worker-floor-scaling" },
    () => {
      const adaptiveSize = computeAdaptivePopulationSize(
        50,
        50,
        15,
        false,
        enabledConfig,
      );
      const workerFloor = scenario.threads *
        enabledConfig.minCreaturesPerWorker;
      Math.max(adaptiveSize, workerFloor);
    },
  );
}

// ──────────────────────────────────────────────────────────────────
// Multi-generation convergence simulation
// ──────────────────────────────────────────────────────────────────

Deno.bench(
  "50-generation low-diversity growth convergence",
  { group: "convergence-simulation" },
  () => {
    let currentSize = 50;
    for (let gen = 0; gen < 50; gen++) {
      currentSize = computeAdaptivePopulationSize(
        50,
        currentSize,
        1, // persistent low diversity
        false,
        enabledConfig,
      );
    }
  },
);

Deno.bench(
  "50-generation mixed-scenario convergence",
  { group: "convergence-simulation" },
  () => {
    let currentSize = 50;
    for (let gen = 0; gen < 50; gen++) {
      // Alternate between growth and stability
      const lowDiversity = gen % 3 === 0;
      const speciesCount = lowDiversity ? 1 : Math.round(currentSize * 0.4);
      currentSize = computeAdaptivePopulationSize(
        50,
        currentSize,
        speciesCount,
        false,
        enabledConfig,
      );
    }
  },
);
