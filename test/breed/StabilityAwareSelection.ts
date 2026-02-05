/**
 * Tests for stability-aware parent selection in breeding.
 *
 * Issue #1307: Reduce brittleness: Adaptive mutation rate based on validation stability.
 *
 * TDD: These tests define the expected behaviour for factoring stability into
 * parent selection during breeding, preferring stable parents when the population
 * shows high brittleness.
 */

import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
} from "@std/assert";
import {
  DEFAULT_STABILITY_SELECTION_CONFIG,
  StabilityAwareSelection,
  type StabilitySelectionConfig,
} from "../../src/breed/StabilityAwareSelection.ts";
import {
  MutationOutcome,
  MutationStabilityTracker,
} from "../../src/NEAT/MutationStabilityTracker.ts";

Deno.test("StabilityAwareSelection - increases selection weight for stable creatures", () => {
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: true,
    stabilityWeight: 0.3, // 30% weight to stability in selection
  };

  const selection = new StabilityAwareSelection(config);

  // Create a stable tracker
  const stableTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    stableTracker.recordOutcome(MutationOutcome.STABLE);
  }

  // Create a brittle tracker
  const brittleTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 8; i++) {
    brittleTracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 2; i++) {
    brittleTracker.recordOutcome(MutationOutcome.STABLE);
  }

  const stableWeight = selection.getSelectionWeight(stableTracker);
  const brittleWeight = selection.getSelectionWeight(brittleTracker);

  // Stable creatures should have higher selection weight
  assertGreater(stableWeight, brittleWeight);
});

Deno.test("StabilityAwareSelection - adjusts fitness score based on stability", () => {
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: true,
    stabilityWeight: 0.2, // 20% weight to stability
  };

  const selection = new StabilityAwareSelection(config);

  const baseFitness = 0.8;

  // Create a stable tracker
  const stableTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    stableTracker.recordOutcome(MutationOutcome.STABLE);
  }

  // Create a brittle tracker
  const brittleTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    brittleTracker.recordOutcome(MutationOutcome.BRITTLE);
  }

  const stableAdjustedFitness = selection.getAdjustedFitness(
    baseFitness,
    stableTracker,
  );
  const brittleAdjustedFitness = selection.getAdjustedFitness(
    baseFitness,
    brittleTracker,
  );

  // Stable creatures should get higher adjusted fitness
  assertGreater(stableAdjustedFitness, brittleAdjustedFitness);
  // Both should still be based on the base fitness
  assertGreater(stableAdjustedFitness, 0);
  assertGreater(brittleAdjustedFitness, 0);
});

Deno.test("StabilityAwareSelection - disabled returns base fitness", () => {
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: false,
    stabilityWeight: 0.3,
  };

  const selection = new StabilityAwareSelection(config);

  const baseFitness = 0.8;

  // Create a brittle tracker
  const brittleTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    brittleTracker.recordOutcome(MutationOutcome.BRITTLE);
  }

  const adjustedFitness = selection.getAdjustedFitness(
    baseFitness,
    brittleTracker,
  );

  // When disabled, should return base fitness unchanged
  assertAlmostEquals(adjustedFitness, baseFitness, 0.0001);
});

Deno.test("StabilityAwareSelection - null tracker returns base fitness", () => {
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: true,
    stabilityWeight: 0.3,
  };

  const selection = new StabilityAwareSelection(config);

  const baseFitness = 0.8;
  const adjustedFitness = selection.getAdjustedFitness(baseFitness, undefined);

  // No tracker means use base fitness
  assertAlmostEquals(adjustedFitness, baseFitness, 0.0001);
});

Deno.test("StabilityAwareSelection - calculates population brittleness level", () => {
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: true,
  };

  const selection = new StabilityAwareSelection(config);

  // Create trackers with varying stability
  const trackers: MutationStabilityTracker[] = [];

  // 3 stable creatures
  for (let i = 0; i < 3; i++) {
    const tracker = new MutationStabilityTracker({
      windowSize: 10,
      brittlenessThreshold: 0.3,
    });
    for (let j = 0; j < 10; j++) {
      tracker.recordOutcome(MutationOutcome.STABLE);
    }
    trackers.push(tracker);
  }

  // 2 brittle creatures
  for (let i = 0; i < 2; i++) {
    const tracker = new MutationStabilityTracker({
      windowSize: 10,
      brittlenessThreshold: 0.3,
    });
    for (let j = 0; j < 8; j++) {
      tracker.recordOutcome(MutationOutcome.BRITTLE);
    }
    for (let j = 0; j < 2; j++) {
      tracker.recordOutcome(MutationOutcome.STABLE);
    }
    trackers.push(tracker);
  }

  const populationBrittleness = selection.getPopulationBrittlenessLevel(
    trackers,
  );

  // 2 out of 5 creatures are brittle = 40%
  assertAlmostEquals(populationBrittleness, 0.4, 0.01);
});

Deno.test("StabilityAwareSelection - increases stability weight when population is brittle-heavy", () => {
  const baseWeight = 0.2;
  const maxWeight = 0.5;
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: true,
    stabilityWeight: baseWeight,
    adaptiveWeightAdjustment: true,
    brittlePopulationThreshold: 0.3, // 30% brittle triggers adaptive adjustment
    maxStabilityWeight: maxWeight,
  };

  const selection = new StabilityAwareSelection(config);

  // Create mostly brittle population (6 brittle, 4 stable = 60% brittle)
  const trackers: MutationStabilityTracker[] = [];

  for (let i = 0; i < 6; i++) {
    const tracker = new MutationStabilityTracker({
      windowSize: 10,
      brittlenessThreshold: 0.3,
    });
    for (let j = 0; j < 8; j++) {
      tracker.recordOutcome(MutationOutcome.BRITTLE);
    }
    for (let j = 0; j < 2; j++) {
      tracker.recordOutcome(MutationOutcome.STABLE);
    }
    trackers.push(tracker);
  }

  for (let i = 0; i < 4; i++) {
    const tracker = new MutationStabilityTracker({
      windowSize: 10,
      brittlenessThreshold: 0.3,
    });
    for (let j = 0; j < 10; j++) {
      tracker.recordOutcome(MutationOutcome.STABLE);
    }
    trackers.push(tracker);
  }

  const adjustedWeight = selection.getAdaptiveStabilityWeight(trackers);

  // Should be higher than base weight due to brittle population
  assertGreater(adjustedWeight, baseWeight);
  // But not exceed max
  assertLess(adjustedWeight, maxWeight + 0.0001);
});

Deno.test("StabilityAwareSelection - returns base weight when population is stable", () => {
  const baseWeight = 0.2;
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: true,
    stabilityWeight: baseWeight,
    adaptiveWeightAdjustment: true,
    brittlePopulationThreshold: 0.3,
  };

  const selection = new StabilityAwareSelection(config);

  // Create mostly stable population (1 brittle, 9 stable = 10% brittle)
  const trackers: MutationStabilityTracker[] = [];

  const brittleTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let j = 0; j < 8; j++) {
    brittleTracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let j = 0; j < 2; j++) {
    brittleTracker.recordOutcome(MutationOutcome.STABLE);
  }
  trackers.push(brittleTracker);

  for (let i = 0; i < 9; i++) {
    const tracker = new MutationStabilityTracker({
      windowSize: 10,
      brittlenessThreshold: 0.3,
    });
    for (let j = 0; j < 10; j++) {
      tracker.recordOutcome(MutationOutcome.STABLE);
    }
    trackers.push(tracker);
  }

  const adjustedWeight = selection.getAdaptiveStabilityWeight(trackers);

  // Population is stable, so weight should be unchanged
  assertAlmostEquals(adjustedWeight, baseWeight, 0.0001);
});

Deno.test("StabilityAwareSelection - getStabilityRanking orders by stability score", () => {
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: true,
  };

  const selection = new StabilityAwareSelection(config);

  // Create trackers with known stability levels
  const brittle = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    brittle.recordOutcome(MutationOutcome.BRITTLE);
  }

  const mixed = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 5; i++) {
    mixed.recordOutcome(MutationOutcome.STABLE);
    mixed.recordOutcome(MutationOutcome.BRITTLE);
  }

  const stable = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    stable.recordOutcome(MutationOutcome.STABLE);
  }

  const ranking = selection.getStabilityRanking([brittle, mixed, stable]);

  // Should be ordered by stability: stable first, brittle last
  assertEquals(ranking[0].tracker, stable);
  assertEquals(ranking[1].tracker, mixed);
  assertEquals(ranking[2].tracker, brittle);
});

Deno.test("StabilityAwareSelection - empty population returns zero brittleness", () => {
  const config: StabilitySelectionConfig = {
    ...DEFAULT_STABILITY_SELECTION_CONFIG,
    enabled: true,
  };

  const selection = new StabilityAwareSelection(config);

  const brittleness = selection.getPopulationBrittlenessLevel([]);

  assertEquals(brittleness, 0);
});
