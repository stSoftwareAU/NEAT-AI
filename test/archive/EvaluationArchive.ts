/**
 * The append-only evaluation archive (Issue #3929).
 *
 * These tests drive the real writer against a real temporary directory and read
 * the bytes back: what is asserted is the archive's contract — exact scores
 * only, one feature space, bounded on disk, and loud on anything it cannot
 * honour.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  EvaluationArchive,
  EXACT_FIDELITY,
} from "@archive/EvaluationArchive.ts";
import { readEvaluationArchive } from "@archive/EvaluationArchiveFormat.ts";
import { EvaluationArchiveError } from "@errors/EvaluationArchiveError.ts";
import { resolveEvaluationArchiveConfig } from "@config/EvaluationArchiveConfig.ts";
import { EVALUATION_DESCRIPTOR_VERSION } from "@archive/EvaluationDescriptor.ts";
import { recordLineage } from "@archive/CreatureLineage.ts";

const BASE: CreatureExport = {
  input: 2,
  output: 1,
  neurons: [
    { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
    { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
  ],
  synapses: [
    { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
    { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
  ],
};

/** A creature with a settled UUID, distinguished by its hidden bias. */
function creatureWithBias(bias: number): Creature {
  const json = structuredClone(BASE);
  json.neurons[0].bias = bias;
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** An archive rooted in a fresh temporary directory. */
async function makeArchive(
  overrides: Record<string, unknown> = {},
): Promise<{ archive: EvaluationArchive; directory: string }> {
  const directory = await Deno.makeTempDir({ prefix: "neat-archive-" });
  const archive = new EvaluationArchive(
    resolveEvaluationArchiveConfig({
      enabled: true,
      directory,
      runId: "run-under-test",
      ...overrides,
    }),
  );
  return { archive, directory };
}

Deno.test("evaluation archive — records an exact evaluation with its provenance", async () => {
  const { archive, directory } = await makeArchive();
  try {
    const mother = creatureWithBias(0.9);
    const father = creatureWithBias(0.8);
    const child = creatureWithBias(0.2);
    recordLineage(child, mother, father);

    archive.beginGeneration(7, mother);
    archive.record(child, {
      score: -0.25,
      fidelity: EXACT_FIDELITY,
      error: 0.25,
      operators: ["AddNeuron", "ModWeight"],
    });
    // One append per generation: nothing is on disk until the flush.
    assertEquals(await readEvaluationArchive(archive.path), []);
    await archive.flush();

    const [record] = await readEvaluationArchive(archive.path);
    assertEquals(record.descriptorVersion, EVALUATION_DESCRIPTOR_VERSION);
    assertEquals(record.runId, "run-under-test");
    assertEquals(record.generation, 7);
    assertEquals(record.uuid, child.uuid);
    assertEquals(record.score, -0.25);
    assertEquals(record.error, 0.25);
    assertEquals(record.fidelity, 1);
    assertEquals(record.operators, ["AddNeuron", "ModWeight"]);
    assertEquals([...record.parents].sort(), [mother.uuid, father.uuid].sort());
    assert(record.recordedAt.endsWith("Z"), "recordedAt is a UTC instant");
    // The genetic-distance slot is relative, so the record names its origin.
    assertEquals(record.referenceUuid, mother.uuid);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — a creature is never recorded as its own parent", async () => {
  // Issue #4004: a mutation can land back on content the creature already had,
  // which re-derives the same hash. A baseline built on that link would predict
  // a creature's score from itself and read as skill.
  const { archive, directory } = await makeArchive();
  try {
    const parent = creatureWithBias(0.4);
    const child = creatureWithBias(0.6);
    recordLineage(child, parent, child);

    archive.beginGeneration(1);
    archive.record(child, { score: 0.5, fidelity: EXACT_FIDELITY });
    await archive.flush();

    const [record] = await readEvaluationArchive(archive.path);
    assertEquals(record.parents, [parent.uuid!]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — a later run appends to the same archive", async () => {
  const { archive, directory } = await makeArchive();
  try {
    archive.beginGeneration(1);
    archive.record(creatureWithBias(0.1), {
      score: 1,
      fidelity: EXACT_FIDELITY,
    });
    await archive.flush();

    // A second run, same directory: cross-run history is the point.
    const second = new EvaluationArchive(
      resolveEvaluationArchiveConfig({
        enabled: true,
        directory,
        runId: "second-run",
      }),
    );
    second.beginGeneration(1);
    second.record(creatureWithBias(0.2), {
      score: 2,
      fidelity: EXACT_FIDELITY,
    });
    await second.flush();

    const records = await readEvaluationArchive(second.path);
    assertEquals(records.length, 2);
    assertEquals(records.map((r) => r.runId), ["run-under-test", "second-run"]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — refuses a score that is not an exact evaluation", async () => {
  const { archive, directory } = await makeArchive();
  try {
    const creature = creatureWithBias(0.3);
    for (const fidelity of [0, -1, 1.5, Number.NaN]) {
      const error = assertThrows(
        () => archive.record(creature, { score: 1, fidelity }),
        EvaluationArchiveError,
      ) as EvaluationArchiveError;
      assertEquals(error.reason, "INVALID_FIDELITY");
    }
    await archive.flush();
    assertEquals(
      await readEvaluationArchive(archive.path),
      [],
      "a refused evaluation must not reach the archive",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — never records a non-finite score or an unidentified creature", async () => {
  const { archive, directory } = await makeArchive();
  try {
    // A WASM panic takes -Infinity; that number describes the runtime, not the
    // design point, so it must not become training data.
    archive.record(creatureWithBias(0.4), {
      score: -Infinity,
      fidelity: EXACT_FIDELITY,
    });

    const unidentified = Creature.fromJSON(structuredClone(BASE));
    delete unidentified.uuid;
    archive.record(unidentified, { score: 1, fidelity: EXACT_FIDELITY });

    await archive.flush();
    assertEquals(await readEvaluationArchive(archive.path), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — retention keeps the newest records and bounds the file", async () => {
  const maxRecords = 10;
  const { archive, directory } = await makeArchive({ maxRecords });
  try {
    // Far past any amortisation slack the writer may allow itself, so the
    // assertion is about the documented bound rather than the rewrite policy.
    const total = 500;
    for (let i = 0; i < total; i++) {
      archive.beginGeneration(i);
      archive.record(creatureWithBias(0.001 * (i + 1)), {
        score: i,
        fidelity: EXACT_FIDELITY,
      });
    }
    await archive.flush();

    const records = await readEvaluationArchive(archive.path);
    // Bounded: it really dropped records, and kept at least what was asked for.
    assert(
      records.length < total,
      `retention must drop records, kept all ${records.length}`,
    );
    assert(
      records.length >= maxRecords,
      `retention must keep at least ${maxRecords}, kept ${records.length}`,
    );
    // And what it kept is the newest contiguous run, oldest first.
    assertEquals(records[records.length - 1].score, total - 1);
    assertEquals(records[0].score, total - records.length);

    // The archive keeps working after a compaction.
    const before = records.length;
    archive.beginGeneration(total);
    archive.record(creatureWithBias(0.9), {
      score: total,
      fidelity: EXACT_FIDELITY,
    });
    await archive.flush();
    const after = await readEvaluationArchive(archive.path);
    assertEquals(after.length, before + 1);
    assertEquals(after[after.length - 1].score, total);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — reading a foreign descriptor version fails loudly", async () => {
  const directory = await Deno.makeTempDir({ prefix: "neat-archive-" });
  const path = `${directory}/evaluations.jsonl`;
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        descriptorVersion: EVALUATION_DESCRIPTOR_VERSION + 99,
        runId: "ancient",
        generation: 1,
        uuid: "abc",
        parents: [],
        operators: [],
        score: 1,
        fidelity: 1,
        recordedAt: "2026-01-01T00:00:00Z",
        descriptor: [1, 2, 3],
      }) + "\n",
    );

    const error = await assertRejects(
      () => readEvaluationArchive(path),
      EvaluationArchiveError,
    ) as EvaluationArchiveError;
    assertEquals(error.reason, "DESCRIPTOR_VERSION_MISMATCH");
    assert(
      error.message.includes("Refusing to mix feature spaces"),
      `unhelpful message: ${error.message}`,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — appending to a foreign-version archive fails loudly", async () => {
  const { archive, directory } = await makeArchive();
  try {
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeTextFile(
      archive.path,
      JSON.stringify({
        descriptorVersion: EVALUATION_DESCRIPTOR_VERSION + 99,
        uuid: "abc",
        score: 1,
        fidelity: 1,
        descriptor: [1, 2, 3],
      }) + "\n",
    );

    archive.record(creatureWithBias(0.6), {
      score: 1,
      fidelity: EXACT_FIDELITY,
    });
    const error = await assertRejects(
      () => archive.flush(),
      EvaluationArchiveError,
    ) as EvaluationArchiveError;
    assertEquals(error.reason, "DESCRIPTOR_VERSION_MISMATCH");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — a foreign version appended later is still caught", async () => {
  const { archive, directory } = await makeArchive();
  try {
    // A current-version archive that a newer build has since appended to. The
    // first line alone would say everything is fine.
    await Deno.mkdir(directory, { recursive: true });
    archive.beginGeneration(1);
    archive.record(creatureWithBias(0.1), {
      score: 1,
      fidelity: EXACT_FIDELITY,
    });
    await archive.flush();
    await Deno.writeTextFile(
      archive.path,
      JSON.stringify({
        descriptorVersion: EVALUATION_DESCRIPTOR_VERSION + 7,
        uuid: "from-a-newer-build",
        score: 2,
        fidelity: 1,
        descriptor: [1, 2, 3],
      }) + "\n",
      { append: true },
    );

    // A fresh writer over the same file must refuse to add a third feature
    // space to it.
    const later = new EvaluationArchive(
      resolveEvaluationArchiveConfig({
        enabled: true,
        directory,
        runId: "later-run",
      }),
    );
    later.beginGeneration(1);
    later.record(creatureWithBias(0.2), {
      score: 3,
      fidelity: EXACT_FIDELITY,
    });
    const error = await assertRejects(
      () => later.flush(),
      EvaluationArchiveError,
    ) as EvaluationArchiveError;
    assertEquals(error.reason, "DESCRIPTOR_VERSION_MISMATCH");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — a failed flush keeps the records it could not write", async () => {
  const { archive, directory } = await makeArchive();
  try {
    await Deno.mkdir(directory, { recursive: true });
    await Deno.writeTextFile(
      archive.path,
      JSON.stringify({
        descriptorVersion: EVALUATION_DESCRIPTOR_VERSION + 99,
        uuid: "foreign",
        score: 1,
        fidelity: 1,
        descriptor: [1, 2, 3],
      }) + "\n",
    );

    const creature = creatureWithBias(0.7);
    archive.beginGeneration(4);
    archive.record(creature, { score: 9, fidelity: EXACT_FIDELITY });
    await assertRejects(() => archive.flush(), EvaluationArchiveError);

    // The error was loud; it must not also have been destructive. Clear the
    // fault and the same evaluation still lands.
    await Deno.remove(archive.path);
    await archive.flush();

    const records = await readEvaluationArchive(archive.path);
    assertEquals(records.length, 1);
    assertEquals(records[0].score, 9);
    assertEquals(records[0].uuid, creature.uuid);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — a wrong-length descriptor is refused, not coerced", async () => {
  const directory = await Deno.makeTempDir({ prefix: "neat-archive-" });
  const path = `${directory}/evaluations.jsonl`;
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        descriptorVersion: EVALUATION_DESCRIPTOR_VERSION,
        uuid: "abc",
        score: 1,
        fidelity: 1,
        descriptor: [1, 2, 3],
      }) + "\n",
    );
    const error = await assertRejects(
      () => readEvaluationArchive(path),
      EvaluationArchiveError,
    ) as EvaluationArchiveError;
    assertEquals(error.reason, "DESCRIPTOR_LENGTH_MISMATCH");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — a torn line is reported, never skipped", async () => {
  const directory = await Deno.makeTempDir({ prefix: "neat-archive-" });
  const path = `${directory}/evaluations.jsonl`;
  try {
    await Deno.writeTextFile(path, '{"descriptorVersion":1,"uuid":"a"\n');
    const error = await assertRejects(
      () => readEvaluationArchive(path),
      EvaluationArchiveError,
    ) as EvaluationArchiveError;
    assertEquals(error.reason, "MALFORMED_RECORD");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation archive — reading an archive that was never written is empty, not an error", async () => {
  const directory = await Deno.makeTempDir({ prefix: "neat-archive-" });
  try {
    assertEquals(
      await readEvaluationArchive(`${directory}/evaluations.jsonl`),
      [],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
