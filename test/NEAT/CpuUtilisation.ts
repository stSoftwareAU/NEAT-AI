/**
 * Unit tests for the CpuUtilisation module (Issue #2395).
 *
 * Exercises `computeOverallCpuUtilisation` and `captureUtilisationSnapshot`
 * now that they are exposed as named exports of their own module. These
 * were previously file-private helpers inside NeatEvolution.ts.
 */
import { assertEquals } from "@std/assert";
import {
  captureUtilisationSnapshot,
  computeOverallCpuUtilisation,
} from "@neat/CpuUtilisation.ts";
import type { WorkerUtilisationSnapshot } from "@config/TrainingEvent.ts";
import type { WorkerPool } from "@multithreading/WorkerPool.ts";

/** Minimal fake implementing the subset of WorkerPool used by the helper. */
function fakePool(active: number, total: number): WorkerPool {
  return {
    getActiveWorkerCount: () => active,
    getWorkerCount: () => total,
  } as unknown as WorkerPool;
}

Deno.test("computeOverallCpuUtilisation: returns 0 when totalMs is non-positive", () => {
  assertEquals(computeOverallCpuUtilisation([], 0), 0);
  assertEquals(computeOverallCpuUtilisation([], -10), 0);
});

Deno.test("computeOverallCpuUtilisation: weights each phase by its duration", () => {
  // 100% utilisation over half the generation, 0% over the other half → 50%.
  const fullyBusy: WorkerUtilisationSnapshot = {
    fastActive: 4,
    fastTotal: 4,
    fastUtilisationPct: 100,
    heavyActive: 0,
    heavyTotal: 0,
    heavyUtilisationPct: 0,
  };
  const result = computeOverallCpuUtilisation(
    [
      { durationMs: 100, snapshot: fullyBusy },
      { durationMs: 100 }, // No snapshot → 0% (main thread only)
    ],
    200,
  );
  assertEquals(result, 50);
});

Deno.test("computeOverallCpuUtilisation: combines fast and heavy pool workers", () => {
  // 2 of 4 fast busy + 1 of 2 heavy busy = 3 of 6 = 50%.
  const partlyBusy: WorkerUtilisationSnapshot = {
    fastActive: 2,
    fastTotal: 4,
    fastUtilisationPct: 50,
    heavyActive: 1,
    heavyTotal: 2,
    heavyUtilisationPct: 50,
  };
  const result = computeOverallCpuUtilisation(
    [{ durationMs: 100, snapshot: partlyBusy }],
    100,
  );
  assertEquals(result, 50);
});

Deno.test("computeOverallCpuUtilisation: zero-duration phases contribute nothing", () => {
  const busy: WorkerUtilisationSnapshot = {
    fastActive: 4,
    fastTotal: 4,
    fastUtilisationPct: 100,
    heavyActive: 0,
    heavyTotal: 0,
    heavyUtilisationPct: 0,
  };
  const result = computeOverallCpuUtilisation(
    [
      { durationMs: 0, snapshot: busy },
      { durationMs: 100, snapshot: busy },
    ],
    100,
  );
  assertEquals(result, 100);
});

Deno.test("computeOverallCpuUtilisation: snapshot with zero workers yields 0", () => {
  const emptySnapshot: WorkerUtilisationSnapshot = {
    fastActive: 0,
    fastTotal: 0,
    fastUtilisationPct: 0,
    heavyActive: 0,
    heavyTotal: 0,
    heavyUtilisationPct: 0,
  };
  const result = computeOverallCpuUtilisation(
    [{ durationMs: 100, snapshot: emptySnapshot }],
    100,
  );
  assertEquals(result, 0);
});

Deno.test("captureUtilisationSnapshot: reports fast and heavy utilisation percentages", () => {
  const snapshot = captureUtilisationSnapshot(
    fakePool(3, 4),
    fakePool(1, 2),
  );
  assertEquals(snapshot.fastActive, 3);
  assertEquals(snapshot.fastTotal, 4);
  assertEquals(snapshot.fastUtilisationPct, 75);
  assertEquals(snapshot.heavyActive, 1);
  assertEquals(snapshot.heavyTotal, 2);
  assertEquals(snapshot.heavyUtilisationPct, 50);
});

Deno.test("captureUtilisationSnapshot: handles pools with zero workers", () => {
  const snapshot = captureUtilisationSnapshot(
    fakePool(0, 0),
    fakePool(0, 0),
  );
  assertEquals(snapshot.fastUtilisationPct, 0);
  assertEquals(snapshot.heavyUtilisationPct, 0);
});
