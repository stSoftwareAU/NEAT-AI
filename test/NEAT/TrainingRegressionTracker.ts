/**
 * Tests for {@link TrainingRegressionTracker} (Issue #2382).
 *
 * Covers the three behaviours called out in the issue's acceptance criteria:
 * - happy path: training improves fitness, streak stays at 0
 * - rollback path: training worsens fitness, streak increments, skip not yet
 *   triggered below threshold
 * - skip path: threshold reached, further attempts are skipped without
 *   launching training
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  POPULATION_PROBE_INTERVAL,
  TrainingRegressionTracker,
} from "@neat/TrainingRegressionTracker.ts";

Deno.test("TrainingRegressionTracker - happy path: improvement keeps streak at zero", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordImprovement("alpha");
  tracker.recordImprovement("alpha");

  assertEquals(tracker.totalImprovements, 2);
  assertEquals(tracker.totalRegressions, 0);
  assertEquals(tracker.regressionRate(), 0);
  assertFalse(tracker.shouldSkip("alpha", 2));
});

Deno.test("TrainingRegressionTracker - rollback path: below threshold does not skip", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("beta");

  assertEquals(tracker.totalRegressions, 1);
  assertEquals(tracker.entries.get("beta")?.consecutiveRegressions, 1);
  // Threshold of 2 means one regression is not yet enough to skip.
  assertFalse(tracker.shouldSkip("beta", 2));
});

Deno.test("TrainingRegressionTracker - skip path: consecutive regressions trigger skip", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("gamma");
  tracker.recordRegression("gamma");

  assert(tracker.shouldSkip("gamma", 2));
  tracker.recordSkip();
  assertEquals(tracker.totalSkipped, 1);
});

Deno.test("TrainingRegressionTracker - improvement resets the streak", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("delta");
  tracker.recordRegression("delta");
  assert(tracker.shouldSkip("delta", 2));

  tracker.recordImprovement("delta");
  assertEquals(tracker.entries.get("delta")?.consecutiveRegressions, 0);
  assertFalse(tracker.shouldSkip("delta", 2));
});

Deno.test("TrainingRegressionTracker - threshold of 0 disables skipping", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("epsilon");
  tracker.recordRegression("epsilon");
  tracker.recordRegression("epsilon");

  assertFalse(tracker.shouldSkip("epsilon", 0));
});

Deno.test("TrainingRegressionTracker - regressionRate reports population ratio", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("a");
  tracker.recordRegression("b");
  tracker.recordRegression("c");
  tracker.recordImprovement("d");

  assertEquals(tracker.totalRegressions, 3);
  assertEquals(tracker.totalImprovements, 1);
  assertEquals(tracker.regressionRate(), 0.75);
});

Deno.test("TrainingRegressionTracker - reset clears history and counters", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("a");
  tracker.recordImprovement("b");
  tracker.recordSkip();

  tracker.reset();

  assertEquals(tracker.totalRegressions, 0);
  assertEquals(tracker.totalImprovements, 0);
  assertEquals(tracker.totalSkipped, 0);
  assertEquals(tracker.entries.size, 0);
  assertEquals(tracker.regressionRate(), 0);
});

Deno.test("TrainingRegressionTracker - shouldSkip returns false for unknown uuid", () => {
  const tracker = new TrainingRegressionTracker();
  assertFalse(tracker.shouldSkip("never-seen", 1));
});

// ---------------------------------------------------------------------------
// Issue #3779: population-wide (run-level) no-progress streak.
//
// Creatures are trained at most once per run (#3553), so a per-UUID streak
// almost never reaches the threshold. The run-level streak counts consecutive
// no-progress outcomes across *every* creature, so a doomed population stops
// dispatching further training.
// ---------------------------------------------------------------------------

Deno.test("TrainingRegressionTracker - population streak counts regressions across creatures", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("a");
  tracker.recordRegression("b");
  tracker.recordRegression("c");

  assertEquals(tracker.populationConsecutiveNoProgress, 3);
  assert(tracker.shouldSkipPopulation(3));
  assertFalse(tracker.shouldSkipPopulation(4));
});

Deno.test("TrainingRegressionTracker - population streak counts no-change outcomes", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordNoChange("a");
  tracker.recordNoChange("b");

  assertEquals(tracker.totalNoChange, 2);
  assertEquals(tracker.populationConsecutiveNoProgress, 2);
  assert(tracker.shouldSkipPopulation(2));
});

Deno.test("TrainingRegressionTracker - no-change neither resets nor grows the per-creature streak", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("a");
  tracker.recordNoChange("a");

  assertEquals(tracker.entries.get("a")?.consecutiveRegressions, 1);
  assertFalse(tracker.shouldSkip("a", 2));
});

Deno.test("TrainingRegressionTracker - an improvement clears the population streak", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("a");
  tracker.recordNoChange("b");
  assertEquals(tracker.populationConsecutiveNoProgress, 2);

  tracker.recordImprovement("c");
  assertEquals(tracker.populationConsecutiveNoProgress, 0);
  assertFalse(tracker.shouldSkipPopulation(2));
});

Deno.test("TrainingRegressionTracker - population threshold of 0 disables the gate", () => {
  const tracker = new TrainingRegressionTracker();
  for (let i = 0; i < 10; i++) tracker.recordRegression(`c${i}`);

  assertFalse(tracker.shouldSkipPopulation(0));
});

Deno.test("TrainingRegressionTracker - gated population lets a probe through periodically", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("a");
  tracker.recordRegression("b");
  assert(tracker.shouldSkipPopulation(2), "gate must trip at the threshold");

  let skipped = 0;
  while (tracker.shouldSkipPopulation(2)) {
    tracker.recordSkip();
    skipped++;
    assert(skipped < 1000, "the gate must eventually let a probe through");
  }

  assertEquals(skipped, POPULATION_PROBE_INTERVAL);
  // The probe dispatch records an outcome, which re-arms the gate.
  tracker.recordRegression("probe");
  assert(tracker.shouldSkipPopulation(2));
});

Deno.test("TrainingRegressionTracker - reset clears the population streak and totals", () => {
  const tracker = new TrainingRegressionTracker();
  tracker.recordRegression("a");
  tracker.recordNoChange("b");
  tracker.recordSkip();

  tracker.reset();

  assertEquals(tracker.populationConsecutiveNoProgress, 0);
  assertEquals(tracker.totalNoChange, 0);
  assertFalse(tracker.shouldSkipPopulation(1));
});
