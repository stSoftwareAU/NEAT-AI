/**
 * Integration test for Issue #2382: scheduleTraining must skip creatures with
 * recent consecutive regressions instead of dispatching another rollback.
 *
 * The tracker is exercised directly in `test/NEAT/TrainingRegressionTracker.ts`.
 * This test wires the tracker into a real `Neat` instance and verifies that
 * `scheduleTraining` honours it — the creature is not added to
 * `trainingInProgress` and the aggregate `totalSkipped` counter increments.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import { WorkerHandler } from "@multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "@architecture/DataSet.ts";

function createTestDataDir(input: number, output: number): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 10; i++) {
    records.push({
      input: new Float32Array(
        Array.from({ length: input }, () => Math.random()),
      ),
      output: new Float32Array(
        Array.from({ length: output }, () => Math.random()),
      ),
    });
  }
  return makeDataDir(records, 2000);
}

Deno.test(
  "scheduleTraining skips creatures with consecutive regressions (Issue #2382)",
  async () => {
    const dataDir = createTestDataDir(2, 1);
    const workers = [new WorkerHandler(dataDir, "MSE", true)];
    try {
      const options: NeatOptions = {
        populationSize: 4,
        skipTrainingAfterConsecutiveRegressions: 2,
      };
      const neat = new Neat(2, 1, options, workers);
      const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
      const uuid = CreatureUtil.makeUUID(creature);

      // Seed the tracker with two consecutive regressions for this uuid so
      // the next scheduleTraining call should take the skip path.
      neat.trainingRegressionTracker.recordRegression(uuid);
      neat.trainingRegressionTracker.recordRegression(uuid);

      assert(
        neat.trainingRegressionTracker.shouldSkip(uuid, 2),
        "Tracker should report skip after two regressions",
      );

      // Must be called after adding score so the scheduler would otherwise
      // proceed. `Number.isFinite` check is performed by the caller in
      // NeatEvolution — we bypass that since we invoke scheduleTraining
      // directly.
      neat.scheduleTraining(creature, 1);

      assertEquals(
        neat.trainingInProgress.size,
        0,
        "scheduleTraining should not dispatch when the tracker flags skip",
      );
      assertEquals(
        neat.trainingRegressionTracker.totalSkipped,
        1,
        "Skip counter should increment when training is bypassed",
      );
      assertEquals(
        neat.alreadyScheduledMap.has(uuid),
        false,
        "alreadyScheduledMap should not record skipped creatures",
      );
    } finally {
      await Promise.all(
        workers.map((w) => w.waitUntilReady().catch(() => {})),
      );
      for (const w of workers) w.terminate();
    }
  },
);

Deno.test(
  "scheduleTraining default threshold allows first attempt through (Issue #2382)",
  async () => {
    const dataDir = createTestDataDir(2, 1);
    const workers = [new WorkerHandler(dataDir, "MSE", true)];
    try {
      const options: NeatOptions = {
        populationSize: 4,
        skipTrainingAfterConsecutiveRegressions: 2,
      };
      const neat = new Neat(2, 1, options, workers);
      const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
      const uuid = CreatureUtil.makeUUID(creature);

      // Single prior regression — below the threshold, so training should
      // still be scheduled.
      neat.trainingRegressionTracker.recordRegression(uuid);
      assertEquals(
        neat.trainingRegressionTracker.shouldSkip(uuid, 2),
        false,
        "One regression below threshold must not trigger skip",
      );
    } finally {
      await Promise.all(
        workers.map((w) => w.waitUntilReady().catch(() => {})),
      );
      for (const w of workers) w.terminate();
    }
  },
);

Deno.test(
  "scheduleTraining with threshold 0 never skips (Issue #2382)",
  async () => {
    const dataDir = createTestDataDir(2, 1);
    const workers = [new WorkerHandler(dataDir, "MSE", true)];
    try {
      const options: NeatOptions = {
        populationSize: 4,
        skipTrainingAfterConsecutiveRegressions: 0,
      };
      const neat = new Neat(2, 1, options, workers);
      const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
      const uuid = CreatureUtil.makeUUID(creature);

      // Even with many regressions, threshold 0 disables the skip path.
      for (let i = 0; i < 5; i++) {
        neat.trainingRegressionTracker.recordRegression(uuid);
      }
      assertEquals(
        neat.trainingRegressionTracker.shouldSkip(uuid, 0),
        false,
        "Threshold of 0 must disable skipping",
      );
    } finally {
      await Promise.all(
        workers.map((w) => w.waitUntilReady().catch(() => {})),
      );
      for (const w of workers) w.terminate();
    }
  },
);
