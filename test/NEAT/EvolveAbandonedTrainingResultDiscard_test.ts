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
 *
 * PR #4114 review: in `evolveDir` the abandoned `evolve()` can instead wait
 * forever at `await breedingPromise`, because the teardown terminates the
 * workers its breed requests are queued on. The teardown test below parks
 * breeding on a promise that only the test releases, runs the teardown while
 * it is parked, and asserts the merged task is still named exactly once.
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
import { ParallelBreeding } from "../../src/breed/ParallelBreeding.ts";
import { runBoundedEvolveTeardown } from "../../src/creature/BoundedEvolveTeardown.ts";

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
      assertEquals(
        neat.mergedUncommittedTrainIDs.size,
        0,
        "a committed generation must clear its merged training IDs",
      );
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

Deno.test(
  "evolveDir teardown: a trained task merged into a generation whose breeding never settles is logged once as discarded (Issue #4107)",
  async () => {
    const workers = [new WorkerHandler(createTestDataDir(), "MSE", true)];
    const previousLogger = getLogger();
    const originalBreedBatch = ParallelBreeding.prototype.breedBatch;
    const captured: CapturedLine[] = [];
    let releaseBreeding: (() => void) | undefined;
    let evolving: Promise<unknown> | undefined;

    const discardLines = () =>
      captured.filter((line) =>
        line.text.includes(`Training ${TASK_ID} discarded`)
      ).map((line) => line.text);

    try {
      const neat = await buildNeat(workers);

      // Stand in for breed requests queued on workers the teardown terminates:
      // WorkerHandlerBase.terminate() drops their callbacks, so they never
      // settle. Here breeding settles only when the test releases it.
      let breedingStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        breedingStarted = resolve;
      });
      ParallelBreeding.prototype.breedBatch = function (
        this: ParallelBreeding,
        ...args: Parameters<ParallelBreeding["breedBatch"]>
      ): Promise<Creature[]> {
        breedingStarted();
        return new Promise<Creature[]>((resolve, reject) => {
          releaseBreeding = () => {
            originalBreedBatch.apply(this, args).then(resolve, reject);
          };
        });
      };
      setLogger(captureLogger(captured));

      evolving = evolve(neat);
      // evolve() runs synchronously from the breedBatch call to
      // `await breedingPromise`, so once this resolves it is parked there,
      // after processCompletedResults() merged the training result.
      await Promise.race([
        started,
        evolving.then(() => {
          throw new Error("evolve() finished without starting to breed");
        }),
      ]);

      assertEquals(
        captured.filter((line) =>
          line.text.includes(`Training ${TASK_ID} completed`)
        ).length,
        1,
        "the training result must have been merged before breeding is awaited",
      );
      assertEquals(neat.trainingComplete.length, 0);
      assertEquals(discardLines(), [], "nothing is discarded yet");

      // What evolveDir does when awaitWithinHardDeadline breaches: abandon the
      // generation, break out of the loop, and run the bounded teardown while
      // the dangling evolve() stays parked.
      neat.generationsCompleted = 1;
      assert(
        neat.abandonInFlightPastHardDeadline(PAST_HARD_DEADLINE_MS),
        "the hard-deadline abandon must actually fire",
      );
      const report = await runBoundedEvolveTeardown({
        label: "evolveDir",
        persist: () => Promise.resolve(),
        neat,
        replayQueue: {
          waitForCompletion: () => Promise.resolve(),
          isReplayInProgress: () => false,
        },
        hardDeadlineMS: 0,
      });

      assertEquals(
        discardLines(),
        [
          `Training ${TASK_ID} discarded: generation abandoned past the hard deadline`,
        ],
        "the teardown must name the merged task while evolve() is still parked",
      );
      assertEquals(report.resultsDiscarded, 1);

      // If the dangling evolve() ever resumes, it must not name the task again.
      releaseBreeding?.();
      releaseBreeding = undefined;
      await evolving;
      assert(
        captured.some((line) =>
          line.text.includes("discarding its population changes instead of")
        ),
        "the resumed evolve() must take its abandoned branch",
      );
      assertEquals(
        discardLines().length,
        1,
        "each merged task is named exactly once, whichever path runs first",
      );
    } finally {
      // Let a still-parked evolve() finish so nothing leaks past the test.
      releaseBreeding?.();
      await evolving?.catch(() => {});
      ParallelBreeding.prototype.breedBatch = originalBreedBatch;
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);

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
      assert(
        neat.mergedUncommittedTrainIDs.has(TASK_ID) &&
          neat.trainingComplete.length === 1,
        "the task must be both recorded as merged and still queued",
      );

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
    } finally {
      setLogger(previousLogger);
      await terminateWorkers(workers);
    }
  },
);
