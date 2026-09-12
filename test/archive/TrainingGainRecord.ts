/**
 * The training-gain log's on-disk format (Issue #3934).
 *
 * Nothing here coerces: a torn line, a missing column, or a record from another
 * descriptor version is refused. A partially readable log is not a smaller log —
 * it is a log whose contents are not what they claim, and a correlation computed
 * over the readable half would carry no warning that the other half was dropped.
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertTrainingGainVersion,
  parseTrainingGainLine,
  readTrainingGainLog,
  trainingErrorGain,
  trainingGain,
  type TrainingGainRecord,
} from "@archive/TrainingGainRecord.ts";
import { TrainingGainLogError } from "@errors/TrainingGainLogError.ts";
import {
  EVALUATION_DESCRIPTOR_LENGTH,
  EVALUATION_DESCRIPTOR_VERSION,
} from "@archive/EvaluationDescriptor.ts";

/** A valid record of the current version. */
function validRecord(
  overrides: Partial<TrainingGainRecord> = {},
): TrainingGainRecord {
  return {
    descriptorVersion: EVALUATION_DESCRIPTOR_VERSION,
    runId: "run",
    generation: 4,
    uuid: "creature-1",
    rank: 2,
    rankedPopulation: 10,
    scoreBefore: -0.8,
    scoreAfter: -0.6,
    wallClockMs: 1_234,
    outcome: "trained",
    dispatchedAt: "2026-09-11T00:00:00Z",
    descriptor: new Array(EVALUATION_DESCRIPTOR_LENGTH).fill(0),
    ...overrides,
  };
}

Deno.test("training-gain format - a valid line round-trips", () => {
  const record = validRecord();
  const parsed = parseTrainingGainLine(JSON.stringify(record), "log", 1);
  assertEquals(assertTrainingGainVersion(parsed, "log", 1), record);
});

Deno.test("training-gain format - a torn line is refused", () => {
  const error = assertThrows(
    () => parseTrainingGainLine('{"descriptorVersion":1,"uu', "log", 3),
    TrainingGainLogError,
  );
  assertEquals(error.reason, "MALFORMED_RECORD");
});

Deno.test("training-gain format - a line that is not an object is refused", () => {
  assertThrows(
    () => parseTrainingGainLine("42", "log", 1),
    TrainingGainLogError,
  );
});

Deno.test("training-gain format - a record missing its rank is refused", () => {
  const broken = { ...validRecord() } as Record<string, unknown>;
  delete broken.rank;
  const error = assertThrows(
    () => parseTrainingGainLine(JSON.stringify(broken), "log", 2),
    TrainingGainLogError,
  );
  assertEquals(error.reason, "MALFORMED_RECORD");
});

Deno.test("training-gain format - a record missing its wall-clock is refused", () => {
  const broken = { ...validRecord() } as Record<string, unknown>;
  delete broken.wallClockMs;
  assertThrows(
    () => parseTrainingGainLine(JSON.stringify(broken), "log", 2),
    TrainingGainLogError,
  );
});

Deno.test("training-gain format - a record missing its pre-training score is refused", () => {
  const broken = { ...validRecord() } as Record<string, unknown>;
  delete broken.scoreBefore;
  assertThrows(
    () => parseTrainingGainLine(JSON.stringify(broken), "log", 2),
    TrainingGainLogError,
  );
});

Deno.test("training-gain format - a record with no outcome is refused", () => {
  const broken = { ...validRecord() } as Record<string, unknown>;
  delete broken.outcome;
  const error = assertThrows(
    () => parseTrainingGainLine(JSON.stringify(broken), "log", 4),
    TrainingGainLogError,
  );
  assertEquals(error.reason, "MALFORMED_RECORD");
});

Deno.test("training-gain format - an unrecognised outcome is refused", () => {
  const broken = { ...validRecord(), outcome: "maybe" };
  assertThrows(
    () => parseTrainingGainLine(JSON.stringify(broken), "log", 4),
    TrainingGainLogError,
  );
});

Deno.test("training-gain format - a record missing its generation is refused", () => {
  const broken = { ...validRecord() } as Record<string, unknown>;
  delete broken.generation;
  assertThrows(
    () => parseTrainingGainLine(JSON.stringify(broken), "log", 5),
    TrainingGainLogError,
  );
});

Deno.test("training-gain format - a record missing its ranked population is refused", () => {
  const broken = { ...validRecord() } as Record<string, unknown>;
  delete broken.rankedPopulation;
  assertThrows(
    () => parseTrainingGainLine(JSON.stringify(broken), "log", 5),
    TrainingGainLogError,
  );
});

Deno.test("training-gain format - a record missing its runId is refused", () => {
  const broken = { ...validRecord() } as Record<string, unknown>;
  delete broken.runId;
  assertThrows(
    () => parseTrainingGainLine(JSON.stringify(broken), "log", 6),
    TrainingGainLogError,
  );
});

Deno.test("training-gain format - a foreign descriptor version is refused", () => {
  const error = assertThrows(
    () =>
      assertTrainingGainVersion(
        validRecord({ descriptorVersion: 99 }),
        "log",
        1,
      ),
    TrainingGainLogError,
  );
  assertEquals(error.reason, "DESCRIPTOR_VERSION_MISMATCH");
});

Deno.test("training-gain format - a wrong-length descriptor is refused", () => {
  const error = assertThrows(
    () =>
      assertTrainingGainVersion(validRecord({ descriptor: [1, 2] }), "log", 1),
    TrainingGainLogError,
  );
  assertEquals(error.reason, "DESCRIPTOR_LENGTH_MISMATCH");
});

Deno.test("trainingErrorGain - the like-for-like reading, and only when it exists", () => {
  // Both terms come from the trainer's own instrument, unlike the two scores
  // `trainingGain` subtracts; positive means the error fell.
  assertEquals(
    trainingErrorGain(validRecord({ errorBefore: 0.5, errorAfter: 0.2 })),
    0.5 - 0.2,
  );
  assertEquals(
    trainingErrorGain(validRecord({ errorBefore: 0.2, errorAfter: 0.5 })),
    0.2 - 0.5,
  );
  // No reading is `undefined`, never 0 — "not measured" must not read as
  // "nothing changed".
  assertEquals(trainingErrorGain(validRecord()), undefined);
  assertEquals(
    trainingErrorGain(validRecord({ errorBefore: 0.5 })),
    undefined,
  );
  assertEquals(
    trainingErrorGain(
      validRecord({ errorBefore: 0.5, errorAfter: Number.NaN }),
    ),
    undefined,
  );
});

Deno.test("training-gain format - gain is the score the step bought", () => {
  assertEquals(
    trainingGain(validRecord({ scoreBefore: -1, scoreAfter: -0.25 })),
    0.75,
  );
});

Deno.test("training-gain format - a step with no score has no gain", () => {
  assertEquals(
    trainingGain(validRecord({ outcome: "failed", scoreAfter: undefined })),
    undefined,
  );
  assertEquals(
    trainingGain(validRecord({ scoreAfter: Number.POSITIVE_INFINITY })),
    undefined,
  );
  assertEquals(
    trainingGain(validRecord({ scoreBefore: Number.NaN })),
    undefined,
  );
});

Deno.test("training-gain format - an absent log reads as empty, not as a fault", async () => {
  const directory = await Deno.makeTempDir({ prefix: "gain-absent-" });
  try {
    assertEquals(await readTrainingGainLog(`${directory}/missing.jsonl`), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain format - reading validates every record", async () => {
  const directory = await Deno.makeTempDir({ prefix: "gain-read-" });
  const path = `${directory}/training-events.jsonl`;
  try {
    await Deno.writeTextFile(
      path,
      [
        JSON.stringify(validRecord({ generation: 1 })),
        JSON.stringify(validRecord({ generation: 2, descriptorVersion: 77 })),
      ].join("\n") + "\n",
    );
    const error = await assertRejects(
      () => readTrainingGainLog(path),
      TrainingGainLogError,
    );
    assertEquals(error.reason, "DESCRIPTOR_VERSION_MISMATCH");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("training-gain format - records read back in write order", async () => {
  const directory = await Deno.makeTempDir({ prefix: "gain-order-" });
  const path = `${directory}/training-events.jsonl`;
  try {
    await Deno.writeTextFile(
      path,
      [1, 2, 3].map((g) => JSON.stringify(validRecord({ generation: g })))
        .join("\n") + "\n",
    );
    const records = await readTrainingGainLog(path);
    assertEquals(records.map((r) => r.generation), [1, 2, 3]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
