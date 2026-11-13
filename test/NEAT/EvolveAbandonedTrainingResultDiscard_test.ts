/**
 * Issue #4107: a training result that `processCompletedResults` has already
 * merged must not vanish silently when the hard deadline abandons the
 * generation before it commits. Each discarded task is logged once, as
 * `discarded`, however many creature variants it produced, and never also as
 * `completed` (Issue #4099: that line is written only at commit).
 *
 * The abandon lands deterministically between `processCompletedResults` and
 * the commit guard: the hook sits on the first `Mutator.prototype.mutate` call
 * of the generation, which `evolve()` makes after result processing and before
 * the guard. The hard-deadline argument is a fixed past instant (no timing API
 * is used).
 *
 * PR #4114 review: in `evolveDir` the abandoned `evolve()` can instead wait
 * forever at `await breedingPromise`, because the teardown terminates the
 * workers its breed requests are queued on. The teardown test below parks
 * breeding on a promise that only the test releases, runs the teardown while
 * it is parked, and asserts the merged task is still named exactly once.
 */

import { assert, assertEquals } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
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
import { ParallelBreeding } from "../../src/breed/ParallelBreeding.ts";
import { evolveDir } from "../../src/creature/CreatureTraining.ts";

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
        0,
        "a task whose generation is abandoned must log only its discarded line, not completed (Issue #4099)",
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
      // The teardown runs after evolve() here; it must not name the task again.
      neat.discardUnprocessedResults();
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} discarded`)
        ).length,
        1,
        "a teardown after the abandoned evolve() must not name the task twice",
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
      // PR #4114 review: the commit must forget the task it merged, or the
      // teardown would later name a committed, persisted creature as discarded.
      // The count from discardUnprocessedResults() is not asserted: the
      // committed generation schedules its own training tasks, and any that
      // settle before the teardown runs are rightly discarded under their own
      // IDs (Issue #4099).
      neat.discardUnprocessedResults();
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} discarded`)
        ).length,
        0,
        "a teardown after a committed generation must not name its task",
      );
    } finally {
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);

Deno.test(
  "evolve: a discovered creature is discarded by its discovery ID without naming an earlier training task (Issue #4107)",
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
          "Discovery discovery-with-stale-train-id discarded: generation abandoned past the hard deadline",
        ],
        "only the training and discovery results merged in the abandoned generation are named",
      );
    } finally {
      Mutator.prototype.mutate = originalMutate;
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);

Deno.test({
  name:
    "evolveDir teardown: a worker result merged before breeding wedges is discarded once and preserves the committed population (Issue #4107)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const dataDir = createTestDataDir();
    const creatureStore = await Deno.makeTempDir({
      prefix: "neat-abandon-4099-",
    });
    const previousLogger = getLogger();
    const originalBreedBatch = ParallelBreeding.prototype.breedBatch;
    const originalTrainTracked = WorkerHandler.prototype.trainTracked;
    const captured: CapturedLine[] = [];
    const start = 32_503_680_000_000;
    let now = start;
    let resolveTraining!: (result: ResponseData) => void;
    const response = new Promise<ResponseData>((resolve) => {
      resolveTraining = resolve;
    });
    let trainID: string | undefined;
    let releaseBreeding: (() => void) | undefined;
    let pendingGeneration: Promise<unknown> | undefined;
    let neat: Neat | undefined;
    let committedPopulation: Creature[] = [];
    let generations = 0;
    let breedCalls = 0;

    WorkerHandler.prototype.trainTracked = function (
      _creature,
      _options,
      label,
    ) {
      trainID = label.slice(-8);
      return { taskID: 4107, response };
    };
    ParallelBreeding.prototype.breedBatch = function (...args) {
      breedCalls++;
      if (breedCalls === 1) return originalBreedBatch.apply(this, args);
      // The external breeding request stalls only in the final merge pass.
      // Advancing the injected clock lets evolveDir itself abandon and tear down.
      now = start + 10 * 60_000;
      return new Promise<Creature[]>((resolve) => {
        releaseBreeding = () => resolve([]);
      });
    };

    try {
      const result = await evolveDir(
        new Creature(2, 1, { layers: [{ count: 3 }] }),
        dataDir,
        {
          populationSize: 10,
          trainPerGen: 1,
          iterations: 1,
          timeoutMinutes: 1,
          threads: 1,
          creatureStore,
        },
        {
          startTimeMS: start,
          now: () => now,
          onNeatReady: (instance) => {
            neat = instance;
            setLogger(captureLogger(captured));
            const realEvolve = instance.evolve.bind(instance);
            instance.evolve = async (...args) => {
              const evolving = realEvolve(...args);
              if (generations === 1) pendingGeneration = evolving;
              const out = await evolving;
              generations++;
              if (generations === 1) {
                committedPopulation = [...instance.population];
                assert(
                  trainID,
                  "the first generation must dispatch a worker task",
                );
                resolveTraining(makeTrainingResult(trainID));
                await response;
              }
              return out;
            };
          },
        },
      );

      assert(neat);
      assert(trainID);
      assertEquals(result.terminationReason, "hard-deadline");
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${trainID} discarded`)
        ),
        [{
          level: "warn",
          text:
            `Training ${trainID} discarded: generation abandoned past the hard deadline`,
        }],
        "the public teardown must give the task exactly one discard line",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${trainID} completed`)
        ),
        [],
        "an abandoned generation must not report completion",
      );
      const members = new Set(committedPopulation);
      assertEquals(neat.population.length, committedPopulation.length);
      assert(
        neat.population.every((c) => members.has(c)),
        "teardown must retain the last committed population",
      );
      let storedCount = 0;
      for await (const entry of Deno.readDir(creatureStore)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        storedCount++;
        const stored = Creature.fromJSON(JSON.parse(
          await Deno.readTextFile(`${creatureStore}/${entry.name}`),
        ));
        assert(
          getTag(stored, "trainID") !== trainID,
          "the abandoned training result must not replace the saved population",
        );
      }

      assert(
        storedCount > 0,
        "the committed population must reach the creature store",
      );

      // A late breeding response must not give the same task a second outcome.
      releaseBreeding?.();
      releaseBreeding = undefined;
      await pendingGeneration;
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${trainID} discarded`)
        ).length,
        1,
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${trainID} completed`)
        ).length,
        0,
      );
    } finally {
      releaseBreeding?.();
      await pendingGeneration?.catch(() => {});
      ParallelBreeding.prototype.breedBatch = originalBreedBatch;
      WorkerHandler.prototype.trainTracked = originalTrainTracked;
      setLogger(previousLogger);
      await Deno.remove(dataDir, { recursive: true });
      await Deno.remove(creatureStore, { recursive: true });
    }
  },
});

Deno.test(
  "discardUnprocessedResults: a task merged by a generation that threw mid-merge is named once (Issue #4107)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    const previousLogger = getLogger();
    const captured: CapturedLine[] = [];

    try {
      const neat = await buildNeat(workers);
      // PR #4114 review: processCompletedResults() records a task's ID before
      // it builds the task's creature variants, and drains trainingComplete
      // only after its whole loop. A variant that fails to load mid-loop
      // leaves the task in both places when evolveDir's failure cleanup runs.
      const broken = makeTrainingResult(TASK_ID);
      broken.train!.compact = { neurons: "not-an-array" } as never;
      neat.trainingComplete.length = 0;
      neat.trainingComplete.push(broken);
      setLogger(captureLogger(captured));

      let threw = false;
      try {
        await evolve(neat);
      } catch {
        threw = true;
      }
      assert(threw, "a variant that fails to load must make evolve() throw");

      assertEquals(
        neat.discardUnprocessedResults(),
        1,
        "the task must be counted once",
      );
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} discarded`)
        ).map((line) => line.text),
        [
          `Training ${TASK_ID} discarded: its generation ended before it committed`,
        ],
        "the task must be named exactly once",
      );
      assertEquals(neat.trainingComplete.length, 0);
      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} completed`)
        ).length,
        0,
        "a task that never committed must not log completed (Issue #4099)",
      );
    } finally {
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);
