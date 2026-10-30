/**
 * Issue #4107: a training result that `processCompletedResults` has already
 * logged as `completed` must not vanish silently when the hard deadline
 * abandons the generation before it commits. Each discarded task is logged
 * once, as `discarded`, however many creature variants it produced.
 *
 * The abandon lands deterministically between `processCompletedResults` and
 * the commit guard: the hook sits on the first `Mutator.prototype.mutate` call
 * of the generation, which `evolve()` makes after result processing and before
 * the guard. The hard-deadline argument is a fixed past instant (no timing API
 * is used).
 */

import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "../../src/Creature.ts";
import type { NeatOptions } from "../../src/config/NeatOptions.ts";
import { Neat } from "../../src/NEAT/Neat.ts";
import { evolve } from "../../src/NEAT/NeatEvolution.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import type { ResponseData } from "../../src/multithreading/workers/WorkerHandler.ts";
import { WorkerHandler } from "../../src/multithreading/workers/WorkerHandler.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import { getLogger, type Logger, setLogger } from "../../src/utils/Logger.ts";

/** A fixed epoch-ms instant that is always in the past. */
const PAST_HARD_DEADLINE_MS = 1_000;

const TASK_ID = "abandoned-task";

/** A training task committed in an earlier generation (PR #4114 review). */
const EARLIER_TASK_ID = "earlier-committed-task";

interface CapturedLine {
  level: string;
  text: string;
}

function createTestDataDir(): string {
  const records: DataRecordInterface[] = [];
  for (let i = 0; i < 20; i++) {
    records.push({
      input: new Float32Array([Math.random(), Math.random()]),
      output: new Float32Array([Math.random()]),
    });
  }
  return makeDataDir(records, 2000);
}

async function terminateWorkers(workers: WorkerHandler[]): Promise<void> {
  await Promise.all(workers.map((w) => w.waitUntilReady().catch(() => {})));
  for (const w of workers) {
    w.terminate();
  }
}

/**
 * A completed training result carrying four creature variants. The
 * backtracked and forward variants are tagged with the trainID at schedule
 * time (as NeatScheduling does), so all four variants share one trainID.
 */
function makeTrainingResult(id: string): ResponseData {
  const variant = () =>
    new Creature(2, 1, { layers: [{ count: 3 }] }).exportJSON();
  const compact = variant();
  addTag(compact, "old-neurons", "5");
  const backtracked = variant();
  const forward = variant();
  addTag(backtracked, "trainID", id);
  addTag(forward, "trainID", id);

  return {
    taskID: 1,
    duration: 1,
    train: {
      ID: id,
      creature: variant(),
      error: 0.1,
      compact,
      backtracked,
      forward,
    },
  } as unknown as ResponseData;
}

/** Build a populated Neat with one completed training result queued. */
async function buildNeat(workers: WorkerHandler[]): Promise<Neat> {
  const seedCreature = new Creature(2, 1, { layers: [{ count: 3 }] });
  const neat = new Neat(2, 1, {
    creatures: [seedCreature.exportJSON()],
    populationSize: 10,
    elitism: 2,
  } as NeatOptions, workers);
  await neat.populatePopulation(seedCreature);
  neat.trainingComplete.push(makeTrainingResult(TASK_ID));
  return neat;
}

/**
 * A settled discovery result whose improved creature carries the trainID tag
 * of an earlier, already committed training task, as one built from a trained
 * fittest does (discovery copies the base creature's tags).
 */
function makeDiscoveryResultWithStaleTrainID(trainID: string): ResponseData {
  const improved = new Creature(2, 1, { layers: [{ count: 3 }] }).exportJSON();
  addTag(improved, "trainID", trainID);
  addTag(improved, "approach", "discovery");
  return {
    taskID: 2,
    duration: 1,
    discover: {
      ID: "discovery-with-stale-train-id",
      creature: {} as never,
      config: {} as never,
      improvedCreature: improved,
    },
  } as unknown as ResponseData;
}

/** A logger that records every line with its level, minus ANSI colour codes. */
function captureLogger(captured: CapturedLine[]): Logger {
  // deno-lint-ignore no-control-regex
  const ansi = /\x1b\[[0-9;]*m/g;
  const at = (level: string) => (...args: unknown[]) => {
    captured.push({
      level,
      text: args.map(String).join(" ").replace(ansi, ""),
    });
  };
  return {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
  };
}

Deno.test(
  "evolve: a trained task discarded by a hard-deadline abandon is logged once as discarded (Issue #4107)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    const previousLogger = getLogger();
    const originalMutate = Mutator.prototype.mutate;
    const captured: CapturedLine[] = [];
    let hookFired = false;

    try {
      const neat = await buildNeat(workers);
      // Members are identified by object reference after the run.
      const before = [...neat.population];

      Mutator.prototype.mutate = function (
        this: Mutator,
        creatures: Creature[],
      ): void {
        if (!hookFired) {
          hookFired = true;
          neat.generationsCompleted = 1;
          assert(
            neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS),
            "the hard-deadline abandon must actually fire",
          );
        }
        originalMutate.call(this, creatures);
      };
      setLogger(captureLogger(captured));

      await evolve(neat);

      assert(hookFired, "the abandon must land before the commit guard");
      assert(
        captured.some((line) =>
          line.text.includes("abandoned past the hard deadline")
        ),
        "the generation must log that it was abandoned past the hard deadline",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} completed`)
        ).length,
        1,
        "the trained task must still log its completed line",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} discarded`)
        ),
        [{
          level: "warn",
          text:
            `Training ${TASK_ID} discarded: generation abandoned past the hard deadline`,
        }],
        "the discarded task must be logged exactly once, as a warning",
      );
      assertEquals(
        neat.population.length,
        before.length,
        "an abandoned generation must not change membership",
      );
      // Membership by reference: a committed generation would swap in bred and
      // trained creatures, which are new objects. Order is not asserted here
      // because fitness sorts neat.population in place before the commit guard.
      const members = new Set(before);
      assert(
        neat.population.every((c) => members.has(c)),
        "an abandoned generation must not replace neat.population's members",
      );
    } finally {
      Mutator.prototype.mutate = originalMutate;
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: a trained task that is committed normally logs completed and no discarded line (Issue #4107)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    const previousLogger = getLogger();
    const captured: CapturedLine[] = [];

    try {
      const neat = await buildNeat(workers);
      setLogger(captureLogger(captured));

      await evolve(neat);

      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} completed`)
        ).length,
        1,
        "the trained task must log its completed line",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} discarded`)
        ).length,
        0,
        "a generation that commits must not log any discarded line",
      );
    } finally {
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: a discovered creature carrying an earlier task's trainID is not named by a hard-deadline abandon (Issue #4107)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    const previousLogger = getLogger();
    const originalMutate = Mutator.prototype.mutate;
    const captured: CapturedLine[] = [];
    let hookFired = false;

    try {
      const neat = await buildNeat(workers);
      neat.discoveryComplete.push(
        makeDiscoveryResultWithStaleTrainID(EARLIER_TASK_ID),
      );

      Mutator.prototype.mutate = function (
        this: Mutator,
        creatures: Creature[],
      ): void {
        if (!hookFired) {
          hookFired = true;
          neat.generationsCompleted = 1;
          assert(
            neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS),
            "the hard-deadline abandon must actually fire",
          );
        }
        originalMutate.call(this, creatures);
      };
      setLogger(captureLogger(captured));

      await evolve(neat);

      assert(hookFired, "the abandon must land before the commit guard");
      assertEquals(
        neat.discoveryComplete.length,
        0,
        "the discovery result must have been merged into the abandoned generation",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${EARLIER_TASK_ID} discarded`)
        ).length,
        0,
        "a task committed in an earlier generation must not be logged as discarded",
      );
      assertEquals(
        captured.filter((line) => line.text.includes(" discarded: ")).map((
          line,
        ) => line.text),
        [
          `Training ${TASK_ID} discarded: generation abandoned past the hard deadline`,
        ],
        "only the training task merged in the abandoned generation is named",
      );
    } finally {
      Mutator.prototype.mutate = originalMutate;
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);
