import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { BatchScorerError } from "../../src/score/BatchScorerReconciler.ts";
import {
  buildBatchScorerDiagnostic,
  extractOffendingStems,
  summariseForwardOnlyComposition,
} from "../../src/score/BatchScorerDiagnostics.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Tests for batch scorer failure diagnostics (Issue #2518).
 *
 * These cover the helpers used by the Fitness.calculate catch block to
 * enrich a BatchScorerError log line with offending creature UUIDs, source
 * tags, topology sizes, and population composition counters.
 */

function makeCreature(uuid: string, forwardOnly: boolean): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.uuid = uuid;
  creature.forwardOnly = forwardOnly;
  return creature;
}

Deno.test("BatchScorerDiagnostics - extractOffendingStems extracts a single UUID from rust stderr", () => {
  const stderr = "Error: Creature " +
    "'/tmp/neat-rust-scorer-batch-7d05/106b96b6-1d76-5752-9cbc-fc826d4f8cbf.json' " +
    "has forwardOnly=false; multi-creature directory mode requires forwardOnly=true.";
  const stems = extractOffendingStems(stderr);
  assertEquals(stems, ["106b96b6-1d76-5752-9cbc-fc826d4f8cbf"]);
});

Deno.test("BatchScorerDiagnostics - extractOffendingStems extracts multiple UUIDs", () => {
  const stderr =
    "Creature '/tmp/x/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json' bad. " +
    "Creature '/tmp/x/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json' also bad. " +
    "Creature '/tmp/x/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json' duplicate.";
  const stems = extractOffendingStems(stderr);
  // Duplicates removed, original order preserved.
  assertEquals(stems, [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  ]);
});

Deno.test("BatchScorerDiagnostics - extractOffendingStems returns empty array for empty/undefined input", () => {
  assertEquals(extractOffendingStems(""), []);
  assertEquals(extractOffendingStems(undefined), []);
  assertEquals(extractOffendingStems("no creature reference here"), []);
});

Deno.test("BatchScorerDiagnostics - summariseForwardOnlyComposition counts all-forwardOnly population", async () => {
  await initWasmForTests();
  const creatures = [
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", true),
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", true),
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3", true),
  ];
  const composition = summariseForwardOnlyComposition(creatures);
  assertEquals(composition.forwardOnlyCount, 3);
  assertEquals(composition.recurrentCount, 0);
});

Deno.test("BatchScorerDiagnostics - summariseForwardOnlyComposition counts mixed population", async () => {
  await initWasmForTests();
  const creatures = [
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", true),
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", false),
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3", true),
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4", false),
  ];
  const composition = summariseForwardOnlyComposition(creatures);
  assertEquals(composition.forwardOnlyCount, 2);
  assertEquals(composition.recurrentCount, 2);
});

Deno.test("BatchScorerDiagnostics - summariseForwardOnlyComposition counts all-recurrent population", async () => {
  await initWasmForTests();
  const creatures = [
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", false),
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", false),
  ];
  const composition = summariseForwardOnlyComposition(creatures);
  assertEquals(composition.forwardOnlyCount, 0);
  assertEquals(composition.recurrentCount, 2);
});

Deno.test("BatchScorerDiagnostics - buildBatchScorerDiagnostic enriches single offender from stderr", async () => {
  await initWasmForTests();
  const offenderUuid = "106b96b6-1d76-5752-9cbc-fc826d4f8cbf";
  const otherUuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
  const offender = makeCreature(offenderUuid, false);
  addTag(offender, "source", "horizontal-gene-transfer");
  const other = makeCreature(otherUuid, true);

  const stderrMessage =
    `Rust scorer batch call failed (exit 1): Error: Creature ` +
    `'/home/n/.tmp/neat-rust-scorer-batch-7d05/${offenderUuid}.json' ` +
    `has forwardOnly=false; multi-creature directory mode requires forwardOnly=true`;
  const err = new BatchScorerError(stderrMessage, "INVALID_JSON");

  const diag = buildBatchScorerDiagnostic(err, [offender, other]);
  assertEquals(diag.reason, "INVALID_JSON");
  assertEquals(diag.composition.forwardOnlyCount, 1);
  assertEquals(diag.composition.recurrentCount, 1);
  assertEquals(diag.offendingStems, [offenderUuid]);
  assertEquals(diag.offenders.length, 1);
  assertEquals(diag.offenders[0].uuid, offenderUuid);
  assertEquals(diag.offenders[0].source, "horizontal-gene-transfer");
  assertEquals(diag.offenders[0].forwardOnly, false);
  assertEquals(diag.offenders[0].unknown, false);
  assert(diag.message.includes("forwardOnly=true=1"));
  assert(diag.message.includes("forwardOnly=false=1"));
  assert(diag.message.includes(`uuid=${offenderUuid}`));
  assert(diag.message.includes("source=horizontal-gene-transfer"));
});

Deno.test("BatchScorerDiagnostics - buildBatchScorerDiagnostic enriches multiple offenders from typed error keys", async () => {
  await initWasmForTests();
  const aUuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
  const bUuid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
  const cUuid = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const a = makeCreature(aUuid, true);
  const b = makeCreature(bUuid, false);
  const c = makeCreature(cUuid, true);

  const err = new BatchScorerError(
    "Batch scorer key set mismatch — missing 1, malformed 1",
    "MISSING_KEYS",
    { missingKeys: [aUuid], malformedKeys: [bUuid] },
  );

  const diag = buildBatchScorerDiagnostic(err, [a, b, c]);
  assertEquals(diag.composition.forwardOnlyCount, 2);
  assertEquals(diag.composition.recurrentCount, 1);
  assertEquals(diag.offendingStems, [aUuid, bUuid]);
  assertEquals(diag.offenders.length, 2);
  assertEquals(diag.offenders[0].forwardOnly, true);
  assertEquals(diag.offenders[1].forwardOnly, false);
  assertEquals(diag.truncated, 0);
});

Deno.test("BatchScorerDiagnostics - buildBatchScorerDiagnostic caps detail at 10 with +N more suffix", async () => {
  await initWasmForTests();
  const creatures: Creature[] = [];
  const stems: string[] = [];
  for (let i = 0; i < 13; i++) {
    const stem = `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa${
      i.toString().padStart(2, "0")
    }`;
    stems.push(stem);
    creatures.push(makeCreature(stem, false));
  }
  const err = new BatchScorerError(
    "missing many",
    "MISSING_KEYS",
    { missingKeys: stems },
  );

  const diag = buildBatchScorerDiagnostic(err, creatures);
  assertEquals(diag.offenders.length, 13);
  assertEquals(diag.truncated, 3);
  assert(
    diag.message.includes("+3 more"),
    `expected message to include "+3 more"; got: ${diag.message}`,
  );
  // The detail list embedded in the message should only include the first 10.
  const firstTen = stems.slice(0, 10);
  for (const stem of firstTen) {
    assert(
      diag.message.includes(stem),
      `expected message to include first-ten stem ${stem}`,
    );
  }
  // The 11th onwards should not be embedded as detail entries.
  for (const stem of stems.slice(10)) {
    assert(
      !diag.message.includes(`uuid=${stem}`),
      `expected message NOT to embed truncated stem detail for ${stem}`,
    );
  }
});

Deno.test("BatchScorerDiagnostics - buildBatchScorerDiagnostic marks unknown stems when not in population", async () => {
  await initWasmForTests();
  const knownUuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
  const unknownUuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const known = makeCreature(knownUuid, true);

  const err = new BatchScorerError(
    `Creature '/tmp/x/${unknownUuid}.json' bad`,
    "INVALID_JSON",
  );

  const diag = buildBatchScorerDiagnostic(err, [known]);
  assertEquals(diag.offenders.length, 1);
  assertEquals(diag.offenders[0].uuid, unknownUuid);
  assertEquals(diag.offenders[0].unknown, true);
  assert(diag.message.includes("unknown=true"));
});

Deno.test("BatchScorerDiagnostics - buildBatchScorerDiagnostic always includes composition even with no offenders", async () => {
  await initWasmForTests();
  const creatures = [
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", true),
    makeCreature("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", false),
  ];
  const err = new Error("scorer crashed with no UUID reference");
  const diag = buildBatchScorerDiagnostic(err, creatures);
  assertEquals(diag.offendingStems, []);
  assertEquals(diag.offenders.length, 0);
  assert(diag.message.includes("forwardOnly=true=1"));
  assert(diag.message.includes("forwardOnly=false=1"));
  assertEquals(diag.reason, "UNKNOWN");
});
