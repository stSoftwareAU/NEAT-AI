/**
 * Integration tests for Issue #3779: the population-wide (run-level) training
 * skip and the structured `training_skipped` event.
 *
 * Creatures are trained at most once per run (#3553), so the per-UUID streak of
 * #2382 almost never reaches its threshold — a doomed population keeps
 * dispatching heavy training tasks. The run-level gate counts consecutive
 * no-progress outcomes across every creature, and every skip is reported
 * through `onTrainingEvent` so a run-end summary can print the totals without
 * `verbose`.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Neat } from "@neat/Neat.ts";
import type { NeatOptions } from "@config/NeatOptions.ts";
import type {
  TrainingEvent,
  TrainingSkippedEvent,
} from "@config/TrainingEvent.ts";
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

async function withNeat(
  options: NeatOptions,
  fn: (neat: Neat) => void,
): Promise<void> {
  const dataDir = createTestDataDir(2, 1);
  const workers = [new WorkerHandler(dataDir, "MSE", true)];
  try {
    fn(new Neat(2, 1, options, workers));
  } finally {
    await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
    for (const w of workers) w.terminate();
  }
}

Deno.test(
  "population-wide no-progress stops further training dispatches (Issue #3779)",
  async () => {
    const skips: TrainingSkippedEvent[] = [];
    await withNeat({
      populationSize: 4,
      skipTrainingAfterConsecutiveRegressions: 0,
      skipTrainingAfterPopulationNoProgress: 3,
      onTrainingEvent: (event: TrainingEvent) => {
        if (event.kind === "training_skipped") skips.push(event);
      },
    }, (neat) => {
      // Three *distinct* creatures each regressed once — no per-UUID streak
      // reaches the #2382 threshold, but the population made no progress.
      neat.trainingRegressionTracker.recordRegression("uuid-a");
      neat.trainingRegressionTracker.recordNoChange("uuid-b");
      neat.trainingRegressionTracker.recordRegression("uuid-c");

      const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
      const uuid = CreatureUtil.makeUUID(creature);
      neat.scheduleTraining(creature, 1);

      assertEquals(
        neat.trainingInProgress.size,
        0,
        "no training task may be dispatched once the population gate trips",
      );
      assertEquals(neat.alreadyScheduledMap.has(uuid), false);
      assertEquals(neat.trainingRegressionTracker.totalSkipped, 1);
      assertEquals(skips.length, 1, "a skip must be reported as an event");
      assertEquals(skips[0].reason, "population_no_progress");
      assertEquals(skips[0].threshold, 3);
      assertEquals(skips[0].consecutiveNoProgress, 3);
      assertEquals(skips[0].totalSkipped, 1);
      assert(skips[0].uuid.length > 0);
    });
  },
);

Deno.test(
  "an improving population keeps dispatching training (Issue #3779)",
  async () => {
    await withNeat({
      populationSize: 4,
      skipTrainingAfterConsecutiveRegressions: 0,
      skipTrainingAfterPopulationNoProgress: 3,
    }, (neat) => {
      neat.trainingRegressionTracker.recordRegression("uuid-a");
      neat.trainingRegressionTracker.recordRegression("uuid-b");
      // A single improvement anywhere in the population clears the streak.
      neat.trainingRegressionTracker.recordImprovement("uuid-c");
      neat.trainingRegressionTracker.recordRegression("uuid-d");

      const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
      const uuid = CreatureUtil.makeUUID(creature);
      neat.scheduleTraining(creature, 1);

      assertEquals(
        neat.trainingRegressionTracker.totalSkipped,
        0,
        "the gate must stay open while the population is still improving",
      );
      assertEquals(
        neat.alreadyScheduledMap.has(uuid),
        true,
        "the creature must be dispatched for training",
      );
    });
  },
);

Deno.test(
  "the population gate is disabled by default (Issue #3779)",
  async () => {
    await withNeat({ populationSize: 4 }, (neat) => {
      assertEquals(neat.config.skipTrainingAfterPopulationNoProgress, 0);
      for (let i = 0; i < 25; i++) {
        neat.trainingRegressionTracker.recordRegression(`uuid-${i}`);
      }

      const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
      neat.scheduleTraining(creature, 1);

      assertEquals(
        neat.trainingRegressionTracker.totalSkipped,
        0,
        "opt-in gate must not fire when unset",
      );
    });
  },
);

Deno.test(
  "a per-creature regression skip is reported as an event (Issue #3779)",
  async () => {
    const skips: TrainingSkippedEvent[] = [];
    await withNeat({
      populationSize: 4,
      skipTrainingAfterConsecutiveRegressions: 2,
      onTrainingEvent: (event: TrainingEvent) => {
        if (event.kind === "training_skipped") skips.push(event);
      },
    }, (neat) => {
      const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
      const uuid = CreatureUtil.makeUUID(creature);
      neat.trainingRegressionTracker.recordRegression(uuid);
      neat.trainingRegressionTracker.recordRegression(uuid);

      neat.scheduleTraining(creature, 1);

      assertEquals(neat.trainingInProgress.size, 0);
      assertEquals(skips.length, 1);
      assertEquals(skips[0].reason, "creature_regressions");
      assertEquals(skips[0].uuid, uuid);
      assertEquals(skips[0].threshold, 2);
      assertEquals(skips[0].consecutiveNoProgress, 2);
    });
  },
);
