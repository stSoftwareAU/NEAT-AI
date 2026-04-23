/**
 * CpuUtilisation.ts - Worker pool utilisation helpers.
 *
 * Extracted from `NeatEvolution.ts` (Issue #2395) so the evolution loop stays
 * focused on orchestration while utilisation sampling/weighting has its own
 * small, testable module.
 */

import type { WorkerUtilisationSnapshot } from "@config/TrainingEvent.ts";
import type { WorkerPool } from "@multithreading/WorkerPool.ts";

/**
 * Captures a point-in-time worker utilisation snapshot from the fast and heavy
 * worker pools.
 *
 * Issue #2312: Lightweight helper used at phase boundaries to record how many
 * workers are active vs idle. Because a single snapshot cannot capture the
 * full utilisation curve across a phase, this deliberately samples at the *end*
 * of each phase — the point most indicative of sustained utilisation.
 */
export function captureUtilisationSnapshot(
  fastPool: WorkerPool,
  heavyPool: WorkerPool,
): WorkerUtilisationSnapshot {
  const fastActive = fastPool.getActiveWorkerCount();
  const fastTotal = fastPool.getWorkerCount();
  const heavyActive = heavyPool.getActiveWorkerCount();
  const heavyTotal = heavyPool.getWorkerCount();
  return {
    fastActive,
    fastTotal,
    fastUtilisationPct: fastTotal > 0
      ? Math.round((fastActive / fastTotal) * 100)
      : 0,
    heavyActive,
    heavyTotal,
    heavyUtilisationPct: heavyTotal > 0
      ? Math.round((heavyActive / heavyTotal) * 100)
      : 0,
  };
}

/**
 * Computes an overall CPU utilisation estimate from per-phase snapshots
 * weighted by their duration.
 *
 * Issue #2312: Each phase's utilisation is weighted by the fraction of total
 * generation time it consumed. Phases with no snapshot are treated as 0%
 * utilisation (main-thread-only work).
 */
export function computeOverallCpuUtilisation(
  phases: Array<{
    durationMs: number;
    snapshot?: WorkerUtilisationSnapshot;
  }>,
  totalMs: number,
): number {
  if (totalMs <= 0) return 0;

  let weightedSum = 0;
  for (const phase of phases) {
    if (phase.snapshot && phase.durationMs > 0) {
      const totalActive = phase.snapshot.fastActive +
        phase.snapshot.heavyActive;
      const totalWorkers = phase.snapshot.fastTotal +
        phase.snapshot.heavyTotal;
      const phaseUtilisation = totalWorkers > 0
        ? totalActive / totalWorkers
        : 0;
      weightedSum += phaseUtilisation * phase.durationMs;
    }
    // Phases without snapshots contribute 0 (main-thread-only).
  }
  return Math.round((weightedSum / totalMs) * 100);
}
