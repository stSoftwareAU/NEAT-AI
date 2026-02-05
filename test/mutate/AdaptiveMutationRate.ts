/**
 * Tests for AdaptiveMutationRate (stability-based mutation adaptation).
 *
 * Issue #1307: Reduce brittleness: Adaptive mutation rate based on validation stability.
 *
 * TDD: These tests define the expected behaviour for adjusting mutation rates
 * and type selection based on creature stability metrics.
 */

import { assertAlmostEquals, assertGreater, assertLess } from "@std/assert";
import {
  AdaptiveMutationRate,
  type AdaptiveMutationRateConfig,
  DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
} from "../../src/NEAT/AdaptiveMutationRate.ts";
import {
  MutationOutcome,
  MutationStabilityTracker,
} from "../../src/NEAT/MutationStabilityTracker.ts";

Deno.test("AdaptiveMutationRate - reduces mutation rate for brittle creatures", () => {
  const baseRate = 0.3;
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
    baseRate,
    brittleReductionFactor: 0.5, // Reduce by 50% when brittle
  };

  const adaptive = new AdaptiveMutationRate(config);

  // Create a brittle tracker
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 6; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 4; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const adjustedRate = adaptive.getAdjustedMutationRate(tracker);

  assertLess(adjustedRate, baseRate);
  assertGreater(adjustedRate, 0);
});

Deno.test("AdaptiveMutationRate - boosts mutation rate for stable creatures", () => {
  const baseRate = 0.3;
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
    baseRate,
    stableBoostFactor: 1.3, // Boost by 30% when very stable
  };

  const adaptive = new AdaptiveMutationRate(config);

  // Create a very stable tracker
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const adjustedRate = adaptive.getAdjustedMutationRate(tracker);

  assertGreater(adjustedRate, baseRate);
});

Deno.test("AdaptiveMutationRate - respects max rate cap", () => {
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
    baseRate: 0.9,
    stableBoostFactor: 2.0,
    maxRate: 1.0,
  };

  const adaptive = new AdaptiveMutationRate(config);

  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const adjustedRate = adaptive.getAdjustedMutationRate(tracker);

  assertLess(adjustedRate, 1.0 + 0.0001); // Should not exceed max rate
});

Deno.test("AdaptiveMutationRate - respects min rate floor", () => {
  const minRate = 0.05;
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
    baseRate: 0.1,
    brittleReductionFactor: 0.1, // 90% reduction
    minRate,
  };

  const adaptive = new AdaptiveMutationRate(config);

  // Create extremely brittle tracker
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }

  const adjustedRate = adaptive.getAdjustedMutationRate(tracker);

  assertGreater(adjustedRate, minRate - 0.0001); // Should not go below min
});

Deno.test("AdaptiveMutationRate - disabled returns base rate", () => {
  const baseRate = 0.3;
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: false,
    baseRate,
  };

  const adaptive = new AdaptiveMutationRate(config);

  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }

  const adjustedRate = adaptive.getAdjustedMutationRate(tracker);

  assertAlmostEquals(adjustedRate, baseRate, 0.0001);
});

Deno.test("AdaptiveMutationRate - adjusts topology mutation weight for brittle creatures", () => {
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
    topologyMutationReductionForBrittle: 0.3, // 70% reduction for topology mutations
  };

  const adaptive = new AdaptiveMutationRate(config);

  // Create brittle tracker
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 8; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 2; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const topologyWeight = adaptive.getTopologyMutationWeight(tracker);

  assertLess(topologyWeight, 1.0);
  assertGreater(topologyWeight, 0);
});

Deno.test("AdaptiveMutationRate - increases weight mutation preference for brittle creatures", () => {
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
  };

  const adaptive = new AdaptiveMutationRate(config);

  // Create brittle tracker
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 8; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 2; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const weightBiasPreference = adaptive.getWeightBiasPreference(tracker);

  // Brittle creatures should favour weight/bias mutations over topology
  assertGreater(weightBiasPreference, 0.75); // Default is 0.75
});

Deno.test("AdaptiveMutationRate - getMutationMagnitudeMultiplier delegates to tracker", () => {
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
  };

  const adaptive = new AdaptiveMutationRate(config);

  // Create brittle tracker
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    magnitudeReductionFactor: 0.5,
  });
  for (let i = 0; i < 8; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 2; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const multiplier = adaptive.getMutationMagnitudeMultiplier(tracker);

  // Should be reduced for brittle creatures
  assertLess(multiplier, 1.0);
});

Deno.test("AdaptiveMutationRate - per-type stability affects mutation type selection", () => {
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
    usePerTypeAdaptation: true,
  };

  const adaptive = new AdaptiveMutationRate(config);

  // Create tracker with per-type tracking
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    trackPerType: true,
  });

  // MOD_WEIGHT is very stable
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE, "MOD_WEIGHT");
  }

  // ADD_NODE is very brittle
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE, "ADD_NODE");
  }

  const weightTypeScore = adaptive.getMutationTypeWeight(tracker, "MOD_WEIGHT");
  const nodeTypeScore = adaptive.getMutationTypeWeight(tracker, "ADD_NODE");

  // MOD_WEIGHT should be preferred over ADD_NODE
  assertGreater(weightTypeScore, nodeTypeScore);
});

Deno.test("AdaptiveMutationRate - null tracker returns base values", () => {
  const baseRate = 0.3;
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
    baseRate,
  };

  const adaptive = new AdaptiveMutationRate(config);

  const adjustedRate = adaptive.getAdjustedMutationRate(undefined);
  const topologyWeight = adaptive.getTopologyMutationWeight(undefined);
  const magnitude = adaptive.getMutationMagnitudeMultiplier(undefined);

  assertAlmostEquals(adjustedRate, baseRate, 0.0001);
  assertAlmostEquals(topologyWeight, 1.0, 0.0001);
  assertAlmostEquals(magnitude, 1.0, 0.0001);
});

Deno.test("AdaptiveMutationRate - empty tracker returns base values", () => {
  const baseRate = 0.3;
  const config: AdaptiveMutationRateConfig = {
    ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
    enabled: true,
    baseRate,
  };

  const adaptive = new AdaptiveMutationRate(config);

  // Create empty tracker
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });

  const adjustedRate = adaptive.getAdjustedMutationRate(tracker);

  // Empty tracker should return base rate (optimistic default)
  assertAlmostEquals(adjustedRate, baseRate, 0.0001);
});
