/**
 * Issue #3930: the capture that raises an evaluation archive for the Stage 1
 * study to be run against.
 *
 * The point of the capture is that the archive is **real** — real creatures,
 * real exact scores, written by the real evaluation path — so the test drives
 * a real (tiny) evolution and reads back what the archive actually holds
 * rather than trusting the script's own return value.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { readEvaluationArchive } from "@archive/EvaluationArchiveFormat.ts";
import { EVALUATION_DESCRIPTOR_LENGTH } from "@archive/EvaluationDescriptor.ts";
import {
  captureArchive,
  seededRng,
  syntheticCorpus,
} from "../../scripts/surrogate_archive_capture.ts";
import { initWasmForTests } from "../_initWasm.ts";

Deno.test("surrogate capture - the generator is deterministic for a seed", () => {
  const first = seededRng(3930);
  const second = seededRng(3930);
  const other = seededRng(17);
  const drawn = Array.from({ length: 8 }, () => first());
  assertEquals(drawn, Array.from({ length: 8 }, () => second()));
  assert(
    drawn.some((value, i) =>
      value !== Array.from({ length: 8 }, () => other())[i]
    ),
    "a different seed must produce a different stream",
  );
  for (const value of drawn) {
    assert(value >= 0 && value < 1, `${value} is outside [0, 1)`);
  }
});

Deno.test("surrogate capture - the corpus is the shape the seed creature is built for", () => {
  const corpus = syntheticCorpus(5, 12, seededRng(1));
  assertEquals(corpus.length, 12);
  for (const record of corpus) {
    assertEquals(record.input.length, 5);
    assertEquals(record.output.length, 1);
    for (const value of record.input) assert(Number.isFinite(value));
    assert(Math.abs(record.output[0]) <= 1, "the target is a tanh");
  }
  assertThrows(() => syntheticCorpus(1, 4, seededRng(1)), Error, "inputs");
  assertThrows(() => syntheticCorpus(4, 0, seededRng(1)), Error, "records");
});

Deno.test("surrogate capture - a real evolution writes readable exact evaluations", async () => {
  await initWasmForTests();
  const directory = await Deno.makeTempDir({ prefix: "surrogate-capture-" });
  try {
    const result = await captureArchive({
      directory,
      runs: 1,
      generations: 2,
      population: 6,
      inputs: 4,
      records: 32,
      seed: 3930,
    });
    assert(result.records > 0, "the capture must write something");
    assertEquals(result.runs, ["capture-3930-0"]);

    const records = await readEvaluationArchive(result.path);
    assertEquals(records.length, result.records);
    for (const record of records) {
      assertEquals(record.runId, "capture-3930-0");
      assertEquals(record.fidelity, 1, "only exact scores are archived");
      assertEquals(record.descriptor.length, EVALUATION_DESCRIPTOR_LENGTH);
      assert(Number.isFinite(record.score));
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
