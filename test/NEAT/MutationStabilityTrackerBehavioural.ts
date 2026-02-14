import { assert, assertEquals, assertGreater, assertLess } from "@std/assert";
import {
  MutationOutcome,
  MutationStabilityTracker,
} from "../../src/NEAT/MutationStabilityTracker.ts";

/**
 * Behavioural tests for mutation stability tracking (MutationStabilityTracker.ts).
 *
 * Issue #1439: Verify that stability tracking correctly identifies
 * stabilised networks, brittle networks, and adjusts mutation magnitude
 * accordingly.
 */

// ============================================================================
// Stability Identification
// ============================================================================

Deno.test("MutationStabilityTrackerBehavioural: identifies stable network", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });

  // Record all stable outcomes
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const metrics = tracker.getMetrics();
  assertEquals(metrics.stabilityRate, 1.0, "Should have 100% stability rate");
  assertEquals(metrics.brittlenessRate, 0.0, "Should have 0% brittleness");
  assertEquals(tracker.isBrittle(), false, "Should not be brittle");
});

Deno.test("MutationStabilityTrackerBehavioural: identifies brittle network", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });

  // Record majority brittle outcomes (>30%)
  for (let i = 0; i < 4; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 6; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  assertEquals(
    tracker.isBrittle(),
    true,
    "Should identify as brittle when brittleness rate >= threshold",
  );
});

Deno.test("MutationStabilityTrackerBehavioural: not brittle when below threshold", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });

  // Record small number of brittle outcomes (<30%)
  for (let i = 0; i < 2; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 8; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  assertEquals(
    tracker.isBrittle(),
    false,
    "Should not be brittle when below threshold",
  );
});

Deno.test("MutationStabilityTrackerBehavioural: tracks failed mutations separately", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });

  tracker.recordOutcome(MutationOutcome.STABLE);
  tracker.recordOutcome(MutationOutcome.STABLE);
  tracker.recordOutcome(MutationOutcome.BRITTLE);
  tracker.recordOutcome(MutationOutcome.FAILED);
  tracker.recordOutcome(MutationOutcome.FAILED);

  const metrics = tracker.getMetrics();
  assertEquals(metrics.totalMutations, 5);
  assertEquals(metrics.stableCount, 2);
  assertEquals(metrics.brittleCount, 1);
  assertEquals(metrics.failedCount, 2);
  assertEquals(metrics.stabilityRate, 0.4);
  assertEquals(metrics.brittlenessRate, 0.2);
});

// ============================================================================
// Rolling Window Behaviour
// ============================================================================

Deno.test("MutationStabilityTrackerBehavioural: rolling window drops old entries", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 5,
    brittlenessThreshold: 0.3,
  });

  // Fill with brittle outcomes
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  assertEquals(tracker.isBrittle(), true, "Should be brittle initially");

  // Now add stable outcomes to push brittle ones out of the window
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  assertEquals(
    tracker.isBrittle(),
    false,
    "Should not be brittle after old entries drop out of window",
  );
  assertEquals(
    tracker.getMetrics().stabilityRate,
    1.0,
    "Window should contain only stable entries",
  );
});

Deno.test("MutationStabilityTrackerBehavioural: empty tracker defaults to optimistic", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });

  const metrics = tracker.getMetrics();
  assertEquals(metrics.totalMutations, 0, "No mutations recorded");
  assertEquals(metrics.stabilityRate, 1.0, "Default to optimistic");
  assertEquals(tracker.isBrittle(), false, "Not brittle by default");
  assertEquals(
    tracker.getMutationMagnitudeMultiplier(),
    1.0,
    "Default multiplier is 1.0",
  );
});

// ============================================================================
// Mutation Magnitude Multiplier
// ============================================================================

Deno.test("MutationStabilityTrackerBehavioural: reduces magnitude for brittle creatures", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    magnitudeReductionFactor: 0.5,
  });

  // Make it clearly brittle
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }

  const multiplier = tracker.getMutationMagnitudeMultiplier();
  assertLess(
    multiplier,
    1.0,
    "Brittle creature should get reduced mutation magnitude",
  );
});

Deno.test("MutationStabilityTrackerBehavioural: boosts magnitude for stable creatures", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    magnitudeBoostFactor: 1.2,
  });

  // Make it very stable (>80%)
  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }

  const multiplier = tracker.getMutationMagnitudeMultiplier();
  assertGreater(
    multiplier,
    1.0,
    "Highly stable creature should get boosted mutation magnitude",
  );
});

Deno.test("MutationStabilityTrackerBehavioural: neutral magnitude for mixed outcomes", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    magnitudeBoostFactor: 1.2,
  });

  // Mix of outcomes — not brittle, not highly stable
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE);
  }
  for (let i = 0; i < 2; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE);
  }
  for (let i = 0; i < 3; i++) {
    tracker.recordOutcome(MutationOutcome.FAILED);
  }

  const multiplier = tracker.getMutationMagnitudeMultiplier();
  assertEquals(
    multiplier,
    1.0,
    "Mixed outcomes should give neutral multiplier",
  );
});

// ============================================================================
// Score Variance Detection
// ============================================================================

Deno.test("MutationStabilityTrackerBehavioural: reclassifies stable as brittle on high score variance", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    scoreVarianceThreshold: 0.1, // 10% threshold
  });

  // Record with high score variance — should be reclassified as brittle
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcomeWithScores(
      MutationOutcome.STABLE,
      -0.5, // training score
      -0.8, // validation score (60% variance from training)
    );
  }

  const metrics = tracker.getMetrics();
  assertEquals(
    metrics.brittleCount,
    5,
    "High score variance should reclassify stable outcomes as brittle",
  );
  assertEquals(metrics.stableCount, 0, "No outcomes should remain stable");
});

Deno.test("MutationStabilityTrackerBehavioural: preserves stable when score variance is low", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    scoreVarianceThreshold: 0.1,
  });

  // Record with low score variance — should remain stable
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcomeWithScores(
      MutationOutcome.STABLE,
      -0.5, // training score
      -0.52, // validation score (4% variance — below 10% threshold)
    );
  }

  const metrics = tracker.getMetrics();
  assertEquals(metrics.stableCount, 5, "Low variance should keep stable");
  assertEquals(metrics.brittleCount, 0, "No brittleness with low variance");
});

// ============================================================================
// Stability Score
// ============================================================================

Deno.test("MutationStabilityTrackerBehavioural: stability score reflects outcome quality", () => {
  // All stable
  const stableTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    stableTracker.recordOutcome(MutationOutcome.STABLE);
  }

  // All failed
  const failedTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 10; i++) {
    failedTracker.recordOutcome(MutationOutcome.FAILED);
  }

  // Mixed
  const mixedTracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
  });
  for (let i = 0; i < 5; i++) {
    mixedTracker.recordOutcome(MutationOutcome.STABLE);
  }
  for (let i = 0; i < 5; i++) {
    mixedTracker.recordOutcome(MutationOutcome.BRITTLE);
  }

  const stableScore = stableTracker.getStabilityScore();
  const failedScore = failedTracker.getStabilityScore();
  const mixedScore = mixedTracker.getStabilityScore();

  assertEquals(stableScore, 1.0, "All-stable should have score 1.0");
  assertEquals(failedScore, 0.0, "All-failed should have score 0.0");
  assertGreater(mixedScore, failedScore, "Mixed should be better than failed");
  assertLess(mixedScore, stableScore, "Mixed should be worse than stable");
});

// ============================================================================
// Per-Type Tracking
// ============================================================================

Deno.test("MutationStabilityTrackerBehavioural: per-type tracking isolates mutation types", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    trackPerType: true,
  });

  // ADD_NODE outcomes are all brittle
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE, "ADD_NODE");
  }

  // MOD_WEIGHT outcomes are all stable
  for (let i = 0; i < 5; i++) {
    tracker.recordOutcome(MutationOutcome.STABLE, "MOD_WEIGHT");
  }

  const addNodeMetrics = tracker.getMetricsForType("ADD_NODE");
  const modWeightMetrics = tracker.getMetricsForType("MOD_WEIGHT");

  assertEquals(
    addNodeMetrics.brittlenessRate,
    1.0,
    "ADD_NODE should be fully brittle",
  );
  assertEquals(
    modWeightMetrics.stabilityRate,
    1.0,
    "MOD_WEIGHT should be fully stable",
  );
});

Deno.test("MutationStabilityTrackerBehavioural: per-type metrics for untracked type defaults empty", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    trackPerType: true,
  });

  tracker.recordOutcome(MutationOutcome.STABLE, "MOD_WEIGHT");

  const unknownMetrics = tracker.getMetricsForType("ADD_BACK_CONN");
  assertEquals(unknownMetrics.totalMutations, 0);
  assertEquals(unknownMetrics.stabilityRate, 1.0, "Default to optimistic");
});

// ============================================================================
// Reset
// ============================================================================

Deno.test("MutationStabilityTrackerBehavioural: reset clears all tracking state", () => {
  const tracker = new MutationStabilityTracker({
    windowSize: 10,
    brittlenessThreshold: 0.3,
    trackPerType: true,
  });

  for (let i = 0; i < 10; i++) {
    tracker.recordOutcome(MutationOutcome.BRITTLE, "ADD_NODE");
  }

  assert(tracker.isBrittle(), "Should be brittle before reset");

  tracker.reset();

  assertEquals(tracker.isBrittle(), false, "Should not be brittle after reset");
  assertEquals(tracker.getMetrics().totalMutations, 0, "History cleared");
  assertEquals(
    tracker.getMetricsForType("ADD_NODE").totalMutations,
    0,
    "Per-type history cleared",
  );
});
