/**
 * Tests for MutationStabilityTracker.
 *
 * Issue #1307: Reduce brittleness: Adaptive mutation rate based on validation stability.
 *
 * TDD: These tests define the expected behaviour for tracking mutation stability
 * per creature, distinguishing between failed validation and passed-but-brittle outcomes.
 */

import { assertEquals, assertGreater, assertLess } from "@std/assert";
import {
  MutationOutcome,
  MutationStabilityTracker,
  type StabilityConfig,
} from "../../src/NEAT/MutationStabilityTracker.ts";

Deno.test("MutationStabilityTracker - tracks stable mutations", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
  };

  const tracker = new MutationStabilityTracker(config);

  // Record 10 stable mutations
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const metrics = tracker.getMetrics();

  assertEquals(metrics.totalMutations, 10);
  assertEquals(metrics.stableCount, 10);
  assertEquals(metrics.failedCount, 0);
  assertEquals(metrics.brittleCount, 0);
  assertEquals(metrics.stabilityRate, 1.0);
  assertEquals(metrics.brittlenessRate, 0.0);
});

Deno.test("MutationStabilityTracker - tracks failed validations", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
  };

  const tracker = new MutationStabilityTracker(config);

  // Record 5 stable and 5 failed
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.FAILED);
  }

  const metrics = tracker.getMetrics();

  assertEquals(metrics.totalMutations, 10);
  assertEquals(metrics.stableCount, 5);
  assertEquals(metrics.failedCount, 5);
  assertEquals(metrics.brittleCount, 0);
  assertEquals(metrics.stabilityRate, 0.5);
});

Deno.test("MutationStabilityTracker - tracks brittle mutations", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
  };

  const tracker = new MutationStabilityTracker(config);

  // Record mix of stable, failed, and brittle
  tracker.recordOutcome(MutationOutcome.STABLE);
  tracker.recordOutcome(MutationOutcome.STABLE);
  tracker.recordOutcome(MutationOutcome.BRITTLE);
  tracker.recordOutcome(MutationOutcome.BRITTLE);
  tracker.recordOutcome(MutationOutcome.BRITTLE);
  tracker.recordOutcome(MutationOutcome.FAILED);
  tracker.recordOutcome(MutationOutcome.FAILED);
  tracker.recordOutcome(MutationOutcome.STABLE);
  tracker.recordOutcome(MutationOutcome.BRITTLE);
  tracker.recordOutcome(MutationOutcome.STABLE);

  const metrics = tracker.getMetrics();

  assertEquals(metrics.totalMutations, 10);
  assertEquals(metrics.stableCount, 4);
  assertEquals(metrics.failedCount, 2);
  assertEquals(metrics.brittleCount, 4);
  assertEquals(metrics.brittlenessRate, 0.4);
});

Deno.test("MutationStabilityTracker - rolling window maintains size", () => {
  const config: StabilityConfig = {
    windowSize: 5,
    brittlenessThreshold: 0.3,
  };

  const tracker = new MutationStabilityTracker(config);

  // Record 3 failed mutations
  for (let i = 0; i < 3; i++) {
    tracker.recordOutcome(MutationOutcome.FAILED);
  }

  // Record 5 stable mutations (these should push out the failed ones)
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const metrics = tracker.getMetrics();

  // Only the last 5 (all stable) should be counted
  assertEquals(metrics.totalMutations, 5);
  assertEquals(metrics.stableCount, 5);
  assertEquals(metrics.failedCount, 0);
  assertEquals(metrics.stabilityRate, 1.0);
});

Deno.test("MutationStabilityTracker - tracks per-mutation-type stability", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
    trackPerType: true,
  };

  const tracker = new MutationStabilityTracker(config);

  // MOD_WEIGHT is very stable
  tracker.recordOutcome(MutationOutcome.STABLE, "MOD_WEIGHT");
  tracker.recordOutcome(MutationOutcome.STABLE, "MOD_WEIGHT");
  tracker.recordOutcome(MutationOutcome.STABLE, "MOD_WEIGHT");

  // ADD_NODE is more brittle
  tracker.recordOutcome(MutationOutcome.BRITTLE, "ADD_NODE");
  tracker.recordOutcome(MutationOutcome.BRITTLE, "ADD_NODE");
  tracker.recordOutcome(MutationOutcome.STABLE, "ADD_NODE");

  const weightMetrics = tracker.getMetricsForType("MOD_WEIGHT");
  const nodeMetrics = tracker.getMetricsForType("ADD_NODE");

  assertEquals(weightMetrics.stableCount, 3);
  assertEquals(weightMetrics.stabilityRate, 1.0);

  assertEquals(nodeMetrics.brittleCount, 2);
  assertEquals(nodeMetrics.stabilityRate, 1 / 3); // 1 stable out of 3
  assertGreater(nodeMetrics.brittlenessRate, 0.6);
});

Deno.test("MutationStabilityTracker - reset clears all history", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
    trackPerType: true,
  };

  const tracker = new MutationStabilityTracker(config);

  tracker.recordOutcome(MutationOutcome.STABLE, "MOD_WEIGHT");
  tracker.recordOutcome(MutationOutcome.BRITTLE, "ADD_NODE");
  tracker.reset();

  const metrics = tracker.getMetrics();
  assertEquals(metrics.totalMutations, 0);
  assertEquals(metrics.stableCount, 0);

  const weightMetrics = tracker.getMetricsForType("MOD_WEIGHT");
  assertEquals(weightMetrics.totalMutations, 0);
});

Deno.test("MutationStabilityTracker - isBrittle returns true above threshold", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3, // 30% brittleness threshold
  };

  const tracker = new MutationStabilityTracker(config);

  // 40% brittle mutations (above threshold)
  for (let i = 0; i < 4; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 6; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  assertEquals(tracker.isBrittle(), true);
});

Deno.test("MutationStabilityTracker - isBrittle returns false below threshold", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3, // 30% brittleness threshold
  };

  const tracker = new MutationStabilityTracker(config);

  // 20% brittle mutations (below threshold)
  for (let i = 0; i < 2; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 8; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  assertEquals(tracker.isBrittle(), false);
});

Deno.test("MutationStabilityTracker - empty tracker returns safe defaults", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
  };

  const tracker = new MutationStabilityTracker(config);
  const metrics = tracker.getMetrics();

  assertEquals(metrics.totalMutations, 0);
  assertEquals(metrics.stableCount, 0);
  assertEquals(metrics.failedCount, 0);
  assertEquals(metrics.brittleCount, 0);
  assertEquals(metrics.stabilityRate, 1.0); // Default to stable (optimistic)
  assertEquals(metrics.brittlenessRate, 0.0);
  assertEquals(tracker.isBrittle(), false);
});

Deno.test("MutationStabilityTracker - records score variance for brittleness detection", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
    scoreVarianceThreshold: 0.1, // 10% variance threshold
  };

  const tracker = new MutationStabilityTracker(config);

  // Record mutation with training vs validation score difference
  tracker.recordOutcomeWithScores(
    MutationOutcome.STABLE,
    0.9, // training score
    0.85, // validation score (5% difference - stable)
  );

  tracker.recordOutcomeWithScores(
    MutationOutcome.STABLE,
    0.9, // training score
    0.7, // validation score (22% difference - brittle)
  );

  const metrics = tracker.getMetrics();
  assertEquals(metrics.totalMutations, 2);
  // The second one should be auto-classified as brittle due to score variance
  assertEquals(metrics.brittleCount, 1);
});

Deno.test("MutationStabilityTracker - getMutationMagnitudeMultiplier for brittle creatures", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
    magnitudeReductionFactor: 0.5, // Reduce magnitude by 50% when brittle
  };

  const tracker = new MutationStabilityTracker(config);

  // Create a very brittle tracker
  for (let i = 0; i < 8; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 2; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const multiplier = tracker.getMutationMagnitudeMultiplier();

  // Should be reduced for brittle creatures
  assertLess(multiplier, 1.0);
  assertGreater(multiplier, 0);
});

Deno.test("MutationStabilityTracker - getMutationMagnitudeMultiplier for stable creatures", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
    magnitudeReductionFactor: 0.5,
    magnitudeBoostFactor: 1.2, // Boost exploration for stable creatures
  };

  const tracker = new MutationStabilityTracker(config);

  // Create a very stable tracker
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const multiplier = tracker.getMutationMagnitudeMultiplier();

  // Should be boosted for stable creatures
  assertGreater(multiplier, 1.0);
});

Deno.test("MutationStabilityTracker - getStabilityScore returns normalised score", () => {
  const config: StabilityConfig = {
    windowSize: 10,
    brittlenessThreshold: 0.3,
  };

  const tracker = new MutationStabilityTracker(config);

  // Half stable, half brittle/failed
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }
  for (let i = 0; i < 3; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 2; i++) {
    tracker.recordOutcome(MutationOutcome.FAILED);
  }

  const score = tracker.getStabilityScore();

  // Score should be between 0 and 1
  assertGreater(score, 0);
  assertLess(score, 1);
});
