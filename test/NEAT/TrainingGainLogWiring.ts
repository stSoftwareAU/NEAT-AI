/**
 * `NeatOptions.trainingGainLog` reaching a real training dispatch (Issue #3934).
 *
 * The log is opt-in run infrastructure, so the seams that matter are
 * config → `Neat`, and `scheduleTraining` → the log: asking for it must produce
 * a record whose rank is the one the selection rule chose at and whose scores
 * bracket the gradient step, and not asking for it must construct nothing and
 * dispatch identically.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { getLogger, setLogger } from "@utils/Logger.ts";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Neat } from "@neat/Neat.ts";
import {
  flushTrainingGainLog,
  scheduleTraining,
} from "@neat/NeatScheduling.ts";
import { TrainingRegressionTracker } from "@neat/TrainingRegressionTracker.ts";
import { TrainingGainLog } from "@archive/TrainingGainLog.ts";
import { readTrainingGainLog } from "@archive/TrainingGainRecord.ts";
import { resolveTrainingGainLogConfig } from "@config/TrainingGainLogConfig.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import type { ResponseData } from "@multithreading/workers/WorkerHandler.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** A trainable forward-only creature carrying the run's error tag. */
function trainableCreature(bias: number, error: number): Creature {
  const creature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
    forwardOnly: true,
  });
  CreatureUtil.makeUUID(creature);
  addTag(creature, "error", `${error}`);
  creature.score = -error;
  return creature;
}

/** Worker stand-in that returns a real trained payload, or a failure. */
class StubWorker {
  trainCalls = 0;

  constructor(
    private readonly reply: (creature: Creature) => ResponseData,
  ) {}

  train(creature: Creature): Promise<ResponseData> {
    this.trainCalls++;
    return Promise.resolve(this.reply(creature));
  }
}

/** A trained reply whose error is `trainedError`. */
function trainedReply(trainedError: number) {
  return (creature: Creature): ResponseData => {
    const trained = Creature.fromJSON(creature.exportJSON());
    // A gradient step moves the weights; the payload must not be the input.
    for (const synapse of trained.synapses) synapse.weight *= 0.5;
    return {
      taskID: 1,
      duration: 10,
      train: {
        ID: creature.uuid!,
        creature: exportJSONWithRuntimeIds(trained),
        error: trainedError,
        trace: {
          input: creature.input,
          output: creature.output,
          neurons: [],
          synapses: [],
        },
      },
    };
  };
}

/** A `Neat` stand-in wired to one worker and, optionally, one log. */
function stubNeat(
  worker: StubWorker,
  log: TrainingGainLog | undefined,
): Neat {
  const pool = { selectWorker: () => worker, getIdleWorkers: () => [] };
  return {
    config: createNeatConfig({}),
    currentGeneration: 9,
    hardDeadlineTS: 0,
    abandonEpoch: 0,
    trainingInProgress: new Map(),
    trainingDeadlines: new Map(),
    alreadyScheduledMap: new Map<string, number>(),
    trainingRegressionTracker: new TrainingRegressionTracker(),
    trainingGainLog: log,
    heavyWorkerPool: pool,
    fastWorkerPool: pool,
    isRunAbandonedSince: () => false,
    recordTrainingComplete: () => {},
  } as unknown as Neat;
}

/**
 * A log in a fresh temporary directory, on a clock the test drives.
 *
 * The clock advances by a fixed step per reading, so `wallClockMs` on the
 * record is a value the test can name rather than merely a non-negative number.
 */
async function newLog(
  stepMs = 250,
): Promise<{ log: TrainingGainLog; directory: string; stepMs: number }> {
  const directory = await Deno.makeTempDir({ prefix: "gain-wiring-" });
  let reading = 0;
  return {
    log: new TrainingGainLog(
      resolveTrainingGainLogConfig({
        enabled: true,
        directory,
        runId: "wiring-run",
      }),
      { now: () => (reading++) * stepMs },
    ),
    directory,
    stepMs,
  };
}

/**
 * Capture what the run reported while `body` ran.
 *
 * A fault that is "reported loudly" is only reported if something can read it,
 * so the report is asserted through the repo's injectable logger rather than
 * left to incidental stderr.
 */
async function captureLogs(body: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = getLogger();
  const record = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  setLogger({ debug: record, info: record, warn: record, error: record });
  try {
    await body();
  } finally {
    setLogger(original);
  }
  return lines;
}

Deno.test("training-gain log - Neat builds no log unless asked", () => {
  const neat = new Neat(2, 1, { populationSize: 4 }, []);
  assertEquals(neat.trainingGainLog, undefined);
});

Deno.test("training-gain log - an enabled log is built from the options", async () => {
  const directory = await Deno.makeTempDir({ prefix: "gain-options-" });
  try {
    const neat = new Neat(
      2,
      1,
      {
        populationSize: 4,
        trainingGainLog: { enabled: true, directory, runId: "options-run" },
      },
      [],
    );
    const log = neat.trainingGainLog;
    assert(log !== undefined, "an enabled log must exist");
    assertEquals(log.path, `${directory}/training-events.jsonl`);
    // Asking for it must not write anything before an event happens.
    const entries: string[] = [];
    for await (const entry of Deno.readDir(directory)) entries.push(entry.name);
    assertEquals(entries, []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - a dispatched step is recorded with its rank and gain", async () => {
  await initWasmForTests();
  const { log, directory, stepMs } = await newLog();
  try {
    const creature = trainableCreature(0.3, 0.5);
    const reference = trainableCreature(0.9, 0.2);
    const worker = new StubWorker(trainedReply(0.25));
    const neat = stubNeat(worker, log);

    scheduleTraining(neat, creature, 5, {
      rank: 4,
      rankedPopulation: 20,
      reference,
    });
    assertEquals(worker.trainCalls, 1);
    await Promise.all(neat.trainingInProgress.values());
    await log.flush();

    const records = await readTrainingGainLog(log.path);
    assertEquals(records.length, 1);
    const record = records[0];
    assertEquals(record.uuid, creature.uuid);
    assertEquals(record.generation, 9);
    assertEquals(record.rank, 4);
    assertEquals(record.rankedPopulation, 20);
    assertEquals(record.outcome, "trained");
    assertEquals(record.errorBefore, 0.5);
    assertEquals(record.errorAfter, 0.25);
    assertEquals(record.scoreBefore, -0.5);
    assert(
      record.scoreAfter !== undefined && record.scoreAfter > record.scoreBefore,
      "a lower error must read as a higher score",
    );
    assertEquals(record.referenceUuid, reference.uuid);
    assertEquals(
      record.wallClockMs,
      stepMs,
      "wall-clock is the injected clock's dispatch-to-outcome delta, not a " +
        "number the log invented",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - a worker failure is recorded as a failed event", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = trainableCreature(0.4, 0.5);
    const worker = new StubWorker((c) => ({
      taskID: 2,
      duration: 5,
      train: {
        ID: c.uuid!,
        creature: exportJSONWithRuntimeIds(c),
        error: Number.POSITIVE_INFINITY,
        trace: {
          input: c.input,
          output: c.output,
          neurons: [],
          synapses: [],
        },
      },
    }));
    const neat = stubNeat(worker, log);

    scheduleTraining(neat, creature, 5, { rank: 0, rankedPopulation: 3 });
    await Promise.all(neat.trainingInProgress.values());
    await log.flush();

    const records = await readTrainingGainLog(log.path);
    assertEquals(records.length, 1);
    assertEquals(records[0].outcome, "failed");
    assertEquals(records[0].scoreAfter, undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - a skipped dispatch logs no event", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = trainableCreature(0.5, 0.5);
    const worker = new StubWorker(trainedReply(0.4));
    const neat = stubNeat(worker, log);
    // Issue #3553: a creature already scheduled this run is never re-dispatched.
    // A literal, not `Date.now()`: AGENTS.md bans timing APIs in test files, and
    // the guard only cares that an entry exists.
    neat.alreadyScheduledMap.set(creature.uuid!, 1);

    scheduleTraining(neat, creature, 5, { rank: 1, rankedPopulation: 4 });

    assertEquals(worker.trainCalls, 0);
    assertEquals(log.pendingCount, 0, "no step, no event");
    await log.flush();
    assertEquals(await readTrainingGainLog(log.path), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - an abandoned run records nothing for the step", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = trainableCreature(0.6, 0.5);
    const worker = new StubWorker(trainedReply(0.3));
    const neat = stubNeat(worker, log);
    (neat as unknown as { isRunAbandonedSince: () => boolean })
      .isRunAbandonedSince = () => true;

    scheduleTraining(neat, creature, 5, { rank: 2, rankedPopulation: 6 });
    await Promise.all(neat.trainingInProgress.values());
    await log.flush();

    assertEquals(log.pendingCount, 0, "the open event is dropped, not left");
    assertEquals(await readTrainingGainLog(log.path), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - the run-end flush appends what is buffered", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = trainableCreature(0.7, 0.5);
    const worker = new StubWorker(trainedReply(0.2));
    const neat = stubNeat(worker, log);

    scheduleTraining(neat, creature, 5, { rank: 0, rankedPopulation: 2 });
    await Promise.all(neat.trainingInProgress.values());
    assertEquals(
      log.bufferedCount,
      1,
      "the outcome is buffered, not yet written",
    );

    // The teardown path the evolve loop runs: whatever settled after the last
    // generation's flush still reaches disk.
    await flushTrainingGainLog(neat);

    assertEquals(log.bufferedCount, 0);
    assertEquals((await readTrainingGainLog(log.path)).length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - a failed append is reported and the records survive", async () => {
  await initWasmForTests();
  const parent = await Deno.makeTempDir({ prefix: "gain-unwritable-" });
  try {
    // A *file* where the log's directory should be: `mkdir` cannot succeed, so
    // the append fails for a reason no retry will fix.
    const directory = `${parent}/blocked`;
    await Deno.writeTextFile(directory, "not a directory\n");
    const log = new TrainingGainLog(
      resolveTrainingGainLogConfig({
        enabled: true,
        directory,
        runId: "io-failure-run",
      }),
    );
    const creature = trainableCreature(0.8, 0.5);
    const worker = new StubWorker(trainedReply(0.3));
    const neat = stubNeat(worker, log);

    scheduleTraining(neat, creature, 5, { rank: 0, rankedPopulation: 1 });
    await Promise.all(neat.trainingInProgress.values());

    // The helper must not let a log fault escape into the training task, and
    // must not destroy the records either.
    const reported = await captureLogs(() => flushTrainingGainLog(neat));
    assertEquals(
      log.bufferedCount,
      1,
      "a loud failure must not be a destructive one",
    );
    const failure = reported.find((line) =>
      line.includes("Training-gain log append failed")
    );
    assert(
      failure !== undefined,
      `the append failure must be reported, got: ${JSON.stringify(reported)}`,
    );
    assertStringIncludes(failure, "1 record(s) are still buffered");
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});
