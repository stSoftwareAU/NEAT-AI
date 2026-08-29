/**
 * GRQ #4537: a change to a creature sheds the score measured before it, and the
 * training-data SHA the score was measured on lives and dies with that score.
 *
 * A `score` tag used to travel through mutation untouched — only the
 * content-derived `uuid` was shed at the mutation site. A consumer reading a
 * creature therefore could not tell a measurement of *this* creature from one
 * inherited across an edit, and grew workarounds to guess.
 *
 * With the invariant in place the tag means exactly one thing: a `score` that
 * is present was measured on the creature carrying it, and an absent one means
 * *not yet measured* — a normal state, not a defect.
 *
 * Two things this must not break: loading is not a change, so a creature read
 * from JSON keeps the score it arrived with; and a tag-only edit is not a
 * change either.
 */
import { assert, assertEquals } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Mutation } from "@neat/Mutation.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { Upgrade } from "@reconstruct/Upgrade.ts";
import {
  DATA_SHA_TAG,
  recordScore,
  SCORE_TAG,
  shedIdentity,
  shedScore,
} from "@architecture/ScoreProvenance.ts";
import { getTrainingDataSha, setTrainingDataSha } from "@globalAccessors";

function scoredExport(): CreatureExport {
  return {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "TANH", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: 0.25 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.8 },
    ],
    input: 2,
    output: 1,
    tags: [
      { name: SCORE_TAG, value: "0.401093" },
      { name: DATA_SHA_TAG, value: "a".repeat(64) },
      { name: "error", value: "0.5" },
    ],
  };
}

/** A creature carrying a score measured on a known corpus. */
function scoredCreature(): Creature {
  return Creature.fromJSON(scoredExport());
}

// ── The score survives a load — loading is not a change ─────────────────────

Deno.test("a creature loaded from JSON keeps the score it arrived with", () => {
  const creature = scoredCreature();

  assertEquals(getTag(creature, SCORE_TAG), "0.401093");
  assertEquals(getTag(creature, DATA_SHA_TAG), "a".repeat(64));
});

Deno.test("a tag-only edit sheds nothing", () => {
  const creature = scoredCreature();
  addTag(creature, "approach", "fine");

  assertEquals(getTag(creature, SCORE_TAG), "0.401093");
  assertEquals(getTag(creature, DATA_SHA_TAG), "a".repeat(64));
});

// ── Every change sheds the score ────────────────────────────────────────────

Deno.test("a bias change sheds the score and its dataSha", () => {
  const creature = scoredCreature();
  const changed = creature.neurons[creature.input].mutate(
    Mutation.MOD_BIAS.name,
  );

  assert(changed, "MOD_BIAS must report a change");
  assertEquals(getTag(creature, SCORE_TAG), null);
  assertEquals(getTag(creature, DATA_SHA_TAG), null);
  assertEquals(creature.uuid, undefined, "identity is shed alongside");
});

Deno.test("a squash change sheds the score and its dataSha", () => {
  const creature = scoredCreature();
  creature.neurons[creature.input].mutate(Mutation.MOD_SQUASH.name);

  assertEquals(getTag(creature, SCORE_TAG), null);
  assertEquals(getTag(creature, DATA_SHA_TAG), null);
});

Deno.test("a structural change sheds the score and its dataSha", () => {
  const creature = scoredCreature();
  const added = new AddNeuron(creature).mutate();

  assert(added, "ADD_NODE must report a change");
  assertEquals(getTag(creature, SCORE_TAG), null);
  assertEquals(getTag(creature, DATA_SHA_TAG), null);
});

Deno.test("tags that are not the score survive a change", () => {
  const creature = scoredCreature();
  creature.neurons[creature.input].mutate(Mutation.MOD_BIAS.name);

  assertEquals(
    getTag(creature, "error"),
    "0.5",
    "only the score pair is shed — other provenance is not this rule's business",
  );
});

// ── Widening is a change too ────────────────────────────────────────────────

Deno.test("widening the input count sheds the score — it was not measured at this width", () => {
  const widened = Upgrade.correct(scoredExport(), 4);

  assertEquals(widened.input, 4);
  assertEquals(getTag(widened, SCORE_TAG), null);
  assertEquals(getTag(widened, DATA_SHA_TAG), null);
});

Deno.test("widening leaves the caller's own JSON untouched", () => {
  const json = scoredExport();
  Upgrade.correct(json, 4);

  assertEquals(
    getTag(json, SCORE_TAG),
    "0.401093",
    "Upgrade.correct works on a copy; the caller's object is not edited",
  );
});

// ── The score and its corpus are written and dropped as one ─────────────────

Deno.test("recordScore stamps the score and the corpus it was measured on", () => {
  const creature = Creature.fromJSON(scoredExport());
  recordScore(creature, 0.25, "b".repeat(64));

  assertEquals(getTag(creature, SCORE_TAG), "0.25");
  assertEquals(getTag(creature, DATA_SHA_TAG), "b".repeat(64));
});

Deno.test("recordScore falls back to the host-configured training-data SHA", () => {
  const previous = getTrainingDataSha();
  setTrainingDataSha("c".repeat(64));
  try {
    const creature = Creature.fromJSON(scoredExport());
    recordScore(creature, 0.25);

    assertEquals(getTag(creature, DATA_SHA_TAG), "c".repeat(64));
  } finally {
    setTrainingDataSha(previous);
  }
});

Deno.test("recordScore with no known corpus drops the inherited dataSha rather than faking one", () => {
  const previous = getTrainingDataSha();
  setTrainingDataSha(undefined);
  try {
    const creature = Creature.fromJSON(scoredExport());
    recordScore(creature, 0.25);

    assertEquals(getTag(creature, SCORE_TAG), "0.25");
    assertEquals(
      getTag(creature, DATA_SHA_TAG),
      null,
      "a score must never claim a corpus it cannot name",
    );
  } finally {
    setTrainingDataSha(previous);
  }
});

Deno.test("shedScore drops both halves and is safe on an unscored creature", () => {
  const creature = scoredCreature();
  shedScore(creature);

  assertEquals(getTag(creature, SCORE_TAG), null);
  assertEquals(getTag(creature, DATA_SHA_TAG), null);

  shedScore(creature);
  assertEquals(getTag(creature, SCORE_TAG), null);
});

Deno.test("shedIdentity sheds the uuid and the score together", () => {
  const creature = scoredCreature();
  creature.uuid = "11111111-1111-4111-8111-111111111111";

  shedIdentity(creature);

  assertEquals(creature.uuid, undefined);
  assertEquals(getTag(creature, SCORE_TAG), null);
  assertEquals(getTag(creature, DATA_SHA_TAG), null);
});

// ── The shed survives an export — this is what a consumer reads ─────────────

Deno.test("an exported mutated creature carries no score for a consumer to trust", () => {
  const creature = scoredCreature();
  creature.neurons[creature.input].mutate(Mutation.MOD_BIAS.name);

  const exported = creature.exportJSON();

  assertEquals(getTag(exported, SCORE_TAG), null);
  assertEquals(getTag(exported, DATA_SHA_TAG), null);
});
