/**
 * The training-gain log writer (Issue #3934).
 *
 * The log's value rests on four properties, and each is tested against real
 * behaviour rather than structure: one record per dispatched gradient step, the
 * pre-training creature as the design point, a refusal rather than a fabricated
 * half when the two halves of an event do not line up, and a bound that
 * announces itself when it stops the log writing.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { TrainingGainLog } from "@archive/TrainingGainLog.ts";
import {
  readTrainingGainLog,
  trainingGain,
} from "@archive/TrainingGainRecord.ts";
import { TrainingGainLogError } from "@errors/TrainingGainLogError.ts";
import {
  resolveTrainingGainLogConfig,
  TRAINING_GAIN_LOG_FILE_NAME,
} from "@config/TrainingGainLogConfig.ts";
import { EVALUATION_DESCRIPTOR_LENGTH } from "@archive/EvaluationDescriptor.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** A distinct identified creature, so records are joinable. */
function creatureWithUuid(bias: number): Creature {
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
  });
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** A log in a fresh temporary directory, with a clock the test drives. */
async function newLog(
  overrides: { maxRecords?: number } = {},
): Promise<{ log: TrainingGainLog; directory: string; tick: () => void }> {
  const directory = await Deno.makeTempDir({ prefix: "training-gain-" });
  let clock = 1_000;
  const log = new TrainingGainLog(
    resolveTrainingGainLogConfig({
      enabled: true,
      directory,
      runId: "test-run",
      ...overrides,
    }),
    { now: () => clock },
  );
  return { log, directory, tick: () => (clock += 250) };
}

Deno.test("training-gain log - one dispatch and outcome become one record", async () => {
  await initWasmForTests();
  const { log, directory, tick } = await newLog();
  try {
    const creature = creatureWithUuid(0.3);
    const reference = creatureWithUuid(0.9);
    log.recordDispatch(creature, {
      generation: 7,
      rank: 3,
      rankedPopulation: 12,
      scoreBefore: -0.5,
      errorBefore: 0.5,
      reference,
    });
    assertEquals(log.pendingCount, 1);
    assertEquals(log.bufferedCount, 0);

    tick();
    log.recordOutcome(creature.uuid!, {
      outcome: "trained",
      scoreAfter: -0.4,
      errorAfter: 0.4,
    });
    assertEquals(log.pendingCount, 0);
    await log.flush();

    const records = await readTrainingGainLog(log.path);
    assertEquals(records.length, 1);
    const record = records[0];
    assertEquals(record.runId, "test-run");
    assertEquals(record.generation, 7);
    assertEquals(record.rank, 3);
    assertEquals(record.rankedPopulation, 12);
    assertEquals(record.scoreBefore, -0.5);
    assertEquals(record.scoreAfter, -0.4);
    assertEquals(record.errorBefore, 0.5);
    assertEquals(record.errorAfter, 0.4);
    assertEquals(record.outcome, "trained");
    assertEquals(record.wallClockMs, 250);
    assertEquals(record.referenceUuid, reference.uuid);
    assertEquals(record.descriptor.length, EVALUATION_DESCRIPTOR_LENGTH);
    // Gain is derived, never stored, so it cannot disagree with the scores.
    const gain = trainingGain(record);
    assert(gain !== undefined);
    assert(Math.abs(gain - 0.1) < 1e-9, `gain was ${gain}`);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - the design point is the creature before the step", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = creatureWithUuid(0.3);
    log.recordDispatch(creature, {
      generation: 1,
      rank: 0,
      rankedPopulation: 4,
      scoreBefore: -1,
    });
    // Training rewrites weights and biases. The record must describe what the
    // selection rule chose, not what the gradient step produced.
    const before = creature.neurons[creature.neurons.length - 1].bias;
    for (const synapse of creature.synapses) synapse.weight = 99;
    log.recordOutcome(creature.uuid!, { outcome: "trained", scoreAfter: -0.9 });
    await log.flush();

    const [record] = await readTrainingGainLog(log.path);
    // Slot 12 is weightMaxAbs — 0.8 before the step, 99 after it.
    assert(
      record.descriptor[12] < 1,
      `weightMaxAbs should be the pre-training 0.8, got ${
        record.descriptor[12]
      }`,
    );
    assertEquals(typeof before, "number");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - a failed step is recorded, not dropped", async () => {
  await initWasmForTests();
  const { log, directory, tick } = await newLog();
  try {
    const creature = creatureWithUuid(0.4);
    log.recordDispatch(creature, {
      generation: 2,
      rank: 1,
      rankedPopulation: 5,
      scoreBefore: -0.7,
    });
    tick();
    log.recordOutcome(creature.uuid!, { outcome: "failed" });
    await log.flush();

    const [record] = await readTrainingGainLog(log.path);
    assertEquals(record.outcome, "failed");
    assertEquals(record.scoreAfter, undefined);
    // No post-training score means no gain — never a zero that averages in.
    assertEquals(trainingGain(record), undefined);
    assertEquals(record.wallClockMs, 250);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - refuses an outcome with no dispatch behind it", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const error = assertThrows(
      () => log.recordOutcome("never-dispatched", { outcome: "trained" }),
      TrainingGainLogError,
    );
    assertEquals(error.reason, "UNKNOWN_EVENT");
    assertEquals(log.bufferedCount, 0);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - an abandoned task records nothing", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = creatureWithUuid(0.5);
    log.recordDispatch(creature, {
      generation: 3,
      rank: 0,
      rankedPopulation: 3,
      scoreBefore: -0.2,
    });
    assertEquals(log.abandon(creature.uuid!), true);
    assertEquals(log.abandon(creature.uuid!), false);
    assertEquals(log.pendingCount, 0);
    await log.flush();
    assertEquals(await readTrainingGainLog(log.path), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - a creature without a UUID is not logged", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = creatureWithUuid(0.7);
    // A creature whose identity was never derived: the record could not be
    // joined to its own outcome, let alone to any other observation of it.
    (creature as { uuid?: string }).uuid = undefined;
    log.recordDispatch(creature, {
      generation: 1,
      rank: 0,
      rankedPopulation: 1,
      scoreBefore: -1,
    });
    assertEquals(log.pendingCount, 0);
    await log.flush();
    assertEquals(await readTrainingGainLog(log.path), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - a dispatch with no measurable score is declined", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = creatureWithUuid(0.8);
    // A WASM-panicked evaluation scores -Infinity. `JSON.stringify` writes a
    // NaN out as `null`, which this module's own reader refuses — so the event
    // is declined rather than written as a line that poisons the file.
    for (const score of [Number.NaN, Number.NEGATIVE_INFINITY]) {
      log.recordDispatch(creature, {
        generation: 1,
        rank: 0,
        rankedPopulation: 4,
        scoreBefore: score,
      });
    }
    assertEquals(log.pendingCount, 0);
    await log.flush();
    assertEquals(await readTrainingGainLog(log.path), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - closeIfOpen closes once and reports a miss", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const creature = creatureWithUuid(0.9);
    log.recordDispatch(creature, {
      generation: 4,
      rank: 2,
      rankedPopulation: 9,
      scoreBefore: -0.6,
    });
    assertEquals(
      log.closeIfOpen(creature.uuid!, { outcome: "trained", scoreAfter: -0.5 }),
      true,
    );
    // A second outcome for the same event is never recorded: the run paid for
    // one step, so one record is what the log may hold.
    assertEquals(
      log.closeIfOpen(creature.uuid!, { outcome: "failed" }),
      false,
    );
    assertEquals(
      log.closeIfOpen("never-dispatched", { outcome: "failed" }),
      false,
    );
    await log.flush();

    const records = await readTrainingGainLog(log.path);
    assertEquals(records.length, 1);
    assertEquals(records[0].outcome, "trained");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - the per-run bound stops the log writing", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog({ maxRecords: 2 });
  try {
    for (let i = 0; i < 4; i++) {
      const creature = creatureWithUuid(0.1 * (i + 1));
      log.recordDispatch(creature, {
        generation: i,
        rank: i,
        rankedPopulation: 4,
        scoreBefore: -1 + i * 0.1,
      });
      log.recordOutcome(creature.uuid!, {
        outcome: "trained",
        scoreAfter: -0.9 + i * 0.1,
      });
      // deno-lint-ignore no-await-in-loop
      await log.flush();
    }
    const records = await readTrainingGainLog(log.path);
    assertEquals(records.length, 2, "the bound is a write bound, not a window");
    assertEquals(records.map((r) => r.generation), [0, 1]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - refuses to append beneath a foreign version", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    // A log written by a build with a different descriptor layout.
    await Deno.writeTextFile(
      `${directory}/${TRAINING_GAIN_LOG_FILE_NAME}`,
      JSON.stringify({
        descriptorVersion: 99,
        runId: "older",
        generation: 0,
        uuid: "older-creature",
        rank: 0,
        rankedPopulation: 1,
        scoreBefore: -1,
        wallClockMs: 1,
        outcome: "trained",
        dispatchedAt: "2026-01-01T00:00:00Z",
        descriptor: [1, 2, 3],
      }) + "\n",
    );
    const creature = creatureWithUuid(0.6);
    log.recordDispatch(creature, {
      generation: 1,
      rank: 0,
      rankedPopulation: 2,
      scoreBefore: -0.5,
    });
    log.recordOutcome(creature.uuid!, { outcome: "trained", scoreAfter: -0.4 });

    const error = await assertRejects(
      () => log.flush(),
      TrainingGainLogError,
    );
    assertEquals(error.reason, "DESCRIPTOR_VERSION_MISMATCH");
    // A loud refusal must not also be destructive.
    assertEquals(log.bufferedCount, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain log - concurrent flushes append whole lines", async () => {
  await initWasmForTests();
  const { log, directory } = await newLog();
  try {
    const flushes: Promise<void>[] = [];
    for (let i = 0; i < 8; i++) {
      const creature = creatureWithUuid(0.05 * (i + 1));
      log.recordDispatch(creature, {
        generation: i,
        rank: i,
        rankedPopulation: 8,
        scoreBefore: -1,
      });
      log.recordOutcome(creature.uuid!, {
        outcome: "trained",
        scoreAfter: -0.5,
      });
      flushes.push(log.flush());
    }
    await Promise.all(flushes);
    const records = await readTrainingGainLog(log.path);
    assertEquals(records.length, 8);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
