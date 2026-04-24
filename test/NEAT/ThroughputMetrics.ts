/**
 * Unit tests for the pure throughput metric helpers.
 *
 * Issue #2330: Validates the FIFO-approximation wait formula, the
 * idle-time clamp, and the assembled `GenerationThroughputMetrics`
 * payload in isolation from the evolve() pipeline.
 */
import { assert, assertEquals } from "@std/assert";
import {
  approximateWaitMs,
  computeIdleMs,
  computeThroughputMetrics,
} from "@neat/ThroughputMetrics.ts";

Deno.test("approximateWaitMs - zero when no queueing pressure", () => {
  // depth <= workers → no task ever waited.
  assertEquals(approximateWaitMs(1000, 4, 4), 0);
  assertEquals(approximateWaitMs(1000, 2, 4), 0);
  assertEquals(approximateWaitMs(1000, 0, 4), 0);
});

Deno.test("approximateWaitMs - zero when inputs are non-positive", () => {
  assertEquals(approximateWaitMs(0, 100, 4), 0);
  assertEquals(approximateWaitMs(-1, 100, 4), 0);
  assertEquals(approximateWaitMs(1000, 100, 0), 0);
});

Deno.test("approximateWaitMs - follows FIFO uniform-task-duration formula", () => {
  // busyMs=1000, depth=10, workers=2
  // Expected ≈ 1000 × (10 - 2) / (2 × 10) = 400
  assertEquals(approximateWaitMs(1000, 10, 2), 400);
});

Deno.test("approximateWaitMs - grows with queue depth", () => {
  const shallow = approximateWaitMs(1000, 6, 4);
  const deep = approximateWaitMs(1000, 60, 4);
  assert(deep > shallow, "deeper queue should imply more wait");
});

Deno.test("computeIdleMs - capacity minus busy", () => {
  // 4 workers × 1000 ms = 4000 capacity; 2500 busy → 1500 idle.
  assertEquals(computeIdleMs(1000, 4, 2500), 1500);
});

Deno.test("computeIdleMs - clamps to zero when busy exceeds capacity", () => {
  // Shouldn't happen physically but guard against clock skew.
  assertEquals(computeIdleMs(1000, 4, 5000), 0);
});

Deno.test("computeIdleMs - zero when wall-clock or workers are zero", () => {
  assertEquals(computeIdleMs(0, 4, 100), 0);
  assertEquals(computeIdleMs(1000, 0, 100), 0);
});

Deno.test("computeThroughputMetrics - assembled payload has required fields", () => {
  const metrics = computeThroughputMetrics({
    wallClockMs: 1000,
    fitnessMs: 600,
    fastWorkerCount: 4,
    heavyWorkerCount: 2,
    fastBusyMs: 2000,
    heavyBusyMs: 800,
    fastQueueMaxDepth: 20,
    heavyQueueMaxDepth: 3,
  });

  assertEquals(metrics.wallClockMs, 1000);
  assertEquals(metrics.nonFitnessMs, 400); // 1000 - 600
  assertEquals(metrics.generationsPerHour, 3_600_000 / 1000);
  assertEquals(metrics.fastBusyMs, 2000);
  assertEquals(metrics.fastIdleMs, 2000); // 4 × 1000 - 2000
  assertEquals(metrics.fastQueueMaxDepth, 20);
  // 2000 × (20 - 4) / (2 × 20) = 800
  assertEquals(metrics.fastWaitMs, 800);
  assertEquals(metrics.heavyBusyMs, 800);
  assertEquals(metrics.heavyIdleMs, 1200); // 2 × 1000 - 800
  assertEquals(metrics.heavyQueueMaxDepth, 3);
  // 800 × (3 - 2) / (2 × 3) ≈ 133
  assertEquals(metrics.heavyWaitMs, Math.round(800 * 1 / 6));
});

Deno.test("computeThroughputMetrics - handles zero wall-clock gracefully", () => {
  const metrics = computeThroughputMetrics({
    wallClockMs: 0,
    fitnessMs: 0,
    fastWorkerCount: 4,
    heavyWorkerCount: 2,
    fastBusyMs: 0,
    heavyBusyMs: 0,
    fastQueueMaxDepth: 0,
    heavyQueueMaxDepth: 0,
  });

  assertEquals(metrics.wallClockMs, 0);
  assertEquals(metrics.nonFitnessMs, 0);
  assertEquals(metrics.generationsPerHour, 0);
  assertEquals(metrics.fastIdleMs, 0);
  assertEquals(metrics.heavyIdleMs, 0);
  assert(Number.isFinite(metrics.generationsPerHour));
});

Deno.test("computeThroughputMetrics - clamps negative inputs to zero", () => {
  const metrics = computeThroughputMetrics({
    wallClockMs: -5,
    fitnessMs: -10,
    fastWorkerCount: -2,
    heavyWorkerCount: -1,
    fastBusyMs: -100,
    heavyBusyMs: -50,
    fastQueueMaxDepth: -3,
    heavyQueueMaxDepth: -1,
  });

  assertEquals(metrics.wallClockMs, 0);
  assertEquals(metrics.nonFitnessMs, 0);
  assertEquals(metrics.fastBusyMs, 0);
  assertEquals(metrics.fastIdleMs, 0);
  assertEquals(metrics.fastQueueMaxDepth, 0);
  assertEquals(metrics.fastWaitMs, 0);
});

Deno.test("computeThroughputMetrics - fitnessMs greater than totalMs produces zero nonFitnessMs", () => {
  // Possible if per-phase timing accumulates differently due to overlap.
  const metrics = computeThroughputMetrics({
    wallClockMs: 500,
    fitnessMs: 600,
    fastWorkerCount: 4,
    heavyWorkerCount: 2,
    fastBusyMs: 1000,
    heavyBusyMs: 0,
    fastQueueMaxDepth: 10,
    heavyQueueMaxDepth: 0,
  });

  assertEquals(metrics.nonFitnessMs, 0);
});

Deno.test("computeThroughputMetrics - scorer fields default to zero when not supplied (Issue #2424)", () => {
  const metrics = computeThroughputMetrics({
    wallClockMs: 1000,
    fitnessMs: 600,
    fastWorkerCount: 4,
    heavyWorkerCount: 2,
    fastBusyMs: 2000,
    heavyBusyMs: 800,
    fastQueueMaxDepth: 20,
    heavyQueueMaxDepth: 3,
  });

  assertEquals(metrics.scoredCreatureCount, 0);
  assertEquals(metrics.scorerMs, 0);
  assertEquals(metrics.creaturesPerSec, 0);
});

Deno.test("computeThroughputMetrics - creaturesPerSec derived from count and fitnessMs (Issue #2424)", () => {
  const metrics = computeThroughputMetrics({
    wallClockMs: 1000,
    fitnessMs: 500,
    fastWorkerCount: 4,
    heavyWorkerCount: 2,
    fastBusyMs: 1000,
    heavyBusyMs: 0,
    fastQueueMaxDepth: 20,
    heavyQueueMaxDepth: 0,
    scoredCreatureCount: 50,
    scorerMs: 12.5,
  });

  assertEquals(metrics.scoredCreatureCount, 50);
  assertEquals(metrics.scorerMs, 12.5);
  // 50 creatures / 0.5s = 100 creatures/sec
  assertEquals(metrics.creaturesPerSec, 100);
});

Deno.test("computeThroughputMetrics - creaturesPerSec is zero when fitnessMs is zero (Issue #2424)", () => {
  const metrics = computeThroughputMetrics({
    wallClockMs: 100,
    fitnessMs: 0,
    fastWorkerCount: 4,
    heavyWorkerCount: 2,
    fastBusyMs: 0,
    heavyBusyMs: 0,
    fastQueueMaxDepth: 0,
    heavyQueueMaxDepth: 0,
    scoredCreatureCount: 10,
    scorerMs: 5,
  });

  // Scored count is preserved even when fitnessMs is zero.
  assertEquals(metrics.scoredCreatureCount, 10);
  assertEquals(metrics.scorerMs, 5);
  // Avoid infinity — zero fitnessMs yields zero throughput.
  assertEquals(metrics.creaturesPerSec, 0);
  assert(Number.isFinite(metrics.creaturesPerSec));
});

Deno.test("computeThroughputMetrics - clamps negative scorer inputs to zero (Issue #2424)", () => {
  const metrics = computeThroughputMetrics({
    wallClockMs: 1000,
    fitnessMs: 500,
    fastWorkerCount: 4,
    heavyWorkerCount: 2,
    fastBusyMs: 0,
    heavyBusyMs: 0,
    fastQueueMaxDepth: 0,
    heavyQueueMaxDepth: 0,
    scoredCreatureCount: -5,
    scorerMs: -10,
  });

  assertEquals(metrics.scoredCreatureCount, 0);
  assertEquals(metrics.scorerMs, 0);
  assertEquals(metrics.creaturesPerSec, 0);
});

Deno.test("computeThroughputMetrics - creaturesPerSec floors count fractionally (Issue #2424)", () => {
  const metrics = computeThroughputMetrics({
    wallClockMs: 1000,
    fitnessMs: 2000,
    fastWorkerCount: 4,
    heavyWorkerCount: 2,
    fastBusyMs: 0,
    heavyBusyMs: 0,
    fastQueueMaxDepth: 0,
    heavyQueueMaxDepth: 0,
    scoredCreatureCount: 123.9,
    scorerMs: 40.25,
  });

  // Floor fractional counts (UUID-uniqueness guarantees integers in practice).
  assertEquals(metrics.scoredCreatureCount, 123);
  assertEquals(metrics.scorerMs, 40.25);
  // 123 / 2 = 61.5
  assertEquals(metrics.creaturesPerSec, 61.5);
});
