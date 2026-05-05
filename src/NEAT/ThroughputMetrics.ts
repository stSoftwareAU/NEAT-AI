/**
 * ThroughputMetrics.ts - Compute per-generation throughput metrics.
 *
 * Issue #2330: Builds the `GenerationThroughputMetrics` payload from
 * lightweight aggregates captured at phase/generation boundaries in
 * `NeatEvolution.evolve()`. Keeps the computation isolated from the
 * already-long evolution module so the formulas can be unit-tested and
 * reasoned about in one place.
 *
 * Issue #2424: Extended with scorer runtime telemetry — aggregate main-thread
 * scorer wall time, unique-scored creature count, and the derived
 * creatures/sec throughput. Captured as cheap counters inside `Fitness.ts`
 * and fed through this helper so operators can compare batch-mode scoring
 * against the per-creature baseline across different hardware.
 */

import type { GenerationThroughputMetrics } from "@config/TrainingEvent.ts";

/**
 * Inputs required to build a throughput metrics payload for a single
 * generation. All fields are either raw wall-clock durations or cumulative
 * counters with deltas computed over the generation window.
 */
export interface ThroughputMetricsInput {
  /** Total wall-clock duration of the generation in ms. */
  readonly wallClockMs: number;
  /** Wall-clock spent in the fitness evaluation phase in ms. */
  readonly fitnessMs: number;
  /** Number of workers in the fast pool. */
  readonly fastWorkerCount: number;
  /** Number of workers in the heavy pool. */
  readonly heavyWorkerCount: number;
  /** Delta of fast-pool cumulative busy-ms over this generation. */
  readonly fastBusyMs: number;
  /** Delta of heavy-pool cumulative busy-ms over this generation. */
  readonly heavyBusyMs: number;
  /** Peak pending-task depth observed on the fast pool this generation. */
  readonly fastQueueMaxDepth: number;
  /** Peak in-flight task count observed on the heavy pool this generation. */
  readonly heavyQueueMaxDepth: number;
  /**
   * Number of unique creatures scored this generation (Issue #2424).
   * Defaults to 0 when unavailable.
   */
  readonly scoredCreatureCount?: number;
  /**
   * Aggregate main-thread wall time spent inside `calculateScore()` during
   * the fitness phase, in ms (Issue #2424). Defaults to 0.
   */
  readonly scorerMs?: number;
  /**
   * Issue #2523: Number of corrupt parent candidates skipped during the
   * breed phase of this generation. Defaults to 0.
   */
  readonly corruptParentSkips?: number;
}

/**
 * Computes the approximate cumulative FIFO queue wait time for a pool.
 *
 * Uses a uniform-task-duration FIFO model:
 *
 *   wait ≈ busyMs × (depth - workers) / (2 × depth)
 *
 * Intuition: the first `workers` tasks start immediately (zero wait); each
 * subsequent task waits for roughly the average task duration multiplied by
 * how deep into the queue it sits. Summed across all tasks and simplified
 * this is `busyMs × (N - W) / (2 × N)` for `N > W`, else zero.
 *
 * This is deliberately an *approximation*. Exact per-task wait would
 * require per-submission timestamps, which the acceptance criteria
 * explicitly discourage ("no per-creature logging in hot paths").
 *
 * @param busyMs aggregate worker-ms spent executing tasks in the window
 * @param depth peak pending-task count observed in the window
 * @param workers worker count in the pool
 * @returns approximate cumulative wait time in ms (non-negative)
 */
export function approximateWaitMs(
  busyMs: number,
  depth: number,
  workers: number,
): number {
  if (busyMs <= 0 || depth <= 0 || workers <= 0) return 0;
  if (depth <= workers) return 0;
  const wait = (busyMs * (depth - workers)) / (2 * depth);
  return wait > 0 ? Math.round(wait) : 0;
}

/**
 * Computes idle worker-ms for a pool.
 *
 * Idle = pool capacity during the window minus aggregate busy time, clamped
 * to zero. Capacity = `workers × wallClockMs`. Returned value is capped at
 * capacity so small rounding glitches in Date.now() deltas cannot yield
 * negative values.
 */
export function computeIdleMs(
  wallClockMs: number,
  workers: number,
  busyMs: number,
): number {
  if (wallClockMs <= 0 || workers <= 0) return 0;
  const capacity = workers * wallClockMs;
  const idle = capacity - Math.max(0, busyMs);
  return idle > 0 ? idle : 0;
}

/**
 * Builds a complete `GenerationThroughputMetrics` payload.
 *
 * All fields are guaranteed to be finite and non-negative. `wallClockMs`
 * of zero yields `generationsPerHour = 0` (rather than infinity) so
 * downstream consumers can safely forward the value to logging or
 * dashboards.
 */
export function computeThroughputMetrics(
  input: ThroughputMetricsInput,
): GenerationThroughputMetrics {
  const wallClockMs = Math.max(0, input.wallClockMs);
  const fitnessMs = Math.max(0, input.fitnessMs);
  const fastBusyMs = Math.max(0, input.fastBusyMs);
  const heavyBusyMs = Math.max(0, input.heavyBusyMs);
  const fastQueueMaxDepth = Math.max(0, Math.floor(input.fastQueueMaxDepth));
  const heavyQueueMaxDepth = Math.max(0, Math.floor(input.heavyQueueMaxDepth));
  const fastWorkerCount = Math.max(0, input.fastWorkerCount);
  const heavyWorkerCount = Math.max(0, input.heavyWorkerCount);

  const nonFitnessMs = Math.max(0, wallClockMs - fitnessMs);
  const generationsPerHour = wallClockMs > 0 ? 3_600_000 / wallClockMs : 0;

  const fastIdleMs = computeIdleMs(wallClockMs, fastWorkerCount, fastBusyMs);
  const heavyIdleMs = computeIdleMs(wallClockMs, heavyWorkerCount, heavyBusyMs);

  const fastWaitMs = approximateWaitMs(
    fastBusyMs,
    fastQueueMaxDepth,
    fastWorkerCount,
  );
  const heavyWaitMs = approximateWaitMs(
    heavyBusyMs,
    heavyQueueMaxDepth,
    heavyWorkerCount,
  );

  // Issue #2424: Scorer telemetry. `scoredCreatureCount` counts unique
  // creatures that hit the main-thread scorer (duplicates resolved by UUID
  // copy are excluded so throughput reflects real scorer work).
  const scoredCreatureCount = Math.max(
    0,
    Math.floor(input.scoredCreatureCount ?? 0),
  );
  const scorerMs = Math.max(0, input.scorerMs ?? 0);
  const creaturesPerSec = fitnessMs > 0 && scoredCreatureCount > 0
    ? (scoredCreatureCount * 1000) / fitnessMs
    : 0;
  const corruptParentSkips = Math.max(
    0,
    Math.floor(input.corruptParentSkips ?? 0),
  );

  return {
    wallClockMs,
    nonFitnessMs,
    generationsPerHour,
    fastBusyMs,
    fastIdleMs,
    fastQueueMaxDepth,
    fastWaitMs,
    heavyBusyMs,
    heavyIdleMs,
    heavyQueueMaxDepth,
    heavyWaitMs,
    scoredCreatureCount,
    scorerMs,
    creaturesPerSec,
    corruptParentSkips,
  };
}
