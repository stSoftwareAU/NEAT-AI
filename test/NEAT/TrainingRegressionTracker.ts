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
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";

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
