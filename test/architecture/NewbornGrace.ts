/**
 * Issue #3970: the newborn grace budget carried on a neuron's tags.
 *
 * The budget is written by `AddNeuron`, read by `compactUnused`, and spent one
 * round at a time — by `compactUnused` on the compacted copy, and by the
 * training teardown on the trained (uncompacted) lineage, so a newborn cannot
 * end up exempt from compaction for the rest of the run.
 */
import { assertEquals, assertThrows } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import {
  ageNewbornGrace,
  NEWBORN_GRACE_TAG,
  newbornGraceRemaining,
  tagNewbornGrace,
} from "@architecture/NewbornGrace.ts";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { ConfigurationError } from "@errors/ConfigurationError.ts";

function tagged(value?: string) {
  const target: { tags?: { name: string; value: string }[] } = {};
  if (value !== undefined) addTag(target, NEWBORN_GRACE_TAG, value);
  return target;
}

Deno.test("tagNewbornGrace - zero rounds writes no tag at all", () => {
  const target = tagged();
  tagNewbornGrace(target, 0);
  assertEquals(target.tags, undefined);
  assertEquals(newbornGraceRemaining(target), 0);
});

Deno.test("tagNewbornGrace - a positive budget is readable back", () => {
  const target = tagged();
  tagNewbornGrace(target, 3);
  assertEquals(newbornGraceRemaining(target), 3);
});

Deno.test("tagNewbornGrace - rejects a negative or fractional budget", () => {
  assertThrows(
    () => tagNewbornGrace(tagged(), -1),
    ConfigurationError,
    "non-negative integer",
  );
  assertThrows(
    () => tagNewbornGrace(tagged(), 1.5),
    ConfigurationError,
    "non-negative integer",
  );
});

Deno.test("newbornGraceRemaining - a malformed tag reads as no protection", () => {
  assertEquals(newbornGraceRemaining(tagged("not-a-number")), 0);
  assertEquals(newbornGraceRemaining(tagged("-4")), 0);
  assertEquals(newbornGraceRemaining(tagged("")), 0);
  assertEquals(newbornGraceRemaining(tagged()), 0);
});

Deno.test("ageNewbornGrace - spends one round and clears a spent budget", () => {
  const creature = {
    neurons: [tagged("2"), tagged("1"), tagged(), tagged("rubbish")],
  };

  ageNewbornGrace(creature);
  assertEquals(newbornGraceRemaining(creature.neurons[0]), 1);
  assertEquals(newbornGraceRemaining(creature.neurons[1]), 0);
  assertEquals(getTag(creature.neurons[1], NEWBORN_GRACE_TAG), null);
  assertEquals(getTag(creature.neurons[3], NEWBORN_GRACE_TAG), null);

  ageNewbornGrace(creature);
  assertEquals(newbornGraceRemaining(creature.neurons[0]), 0);
  assertEquals(getTag(creature.neurons[0], NEWBORN_GRACE_TAG), null);

  // Idempotent once every budget is spent.
  ageNewbornGrace(creature);
  assertEquals(newbornGraceRemaining(creature.neurons[0]), 0);
});

Deno.test("newborn grace - the budget survives export and re-import", () => {
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 1 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 1,
    output: 1,
  };
  const creature = Creature.fromJSON(json);
  const hidden = creature.neurons.find((n) => n.type === "hidden")!;
  // Compute the identity for real: `fromJSON` deliberately leaves
  // `creature.uuid` undefined, so reading the field would compare undefined
  // with undefined and prove nothing.
  const uuidBefore = CreatureUtil.makeUUID(creature);
  tagNewbornGrace(hidden, 2);

  // Tags are excluded from makeUUID, so tagging cannot shift identity.
  delete creature.uuid;
  assertEquals(CreatureUtil.makeUUID(creature), uuidBefore);

  const reloaded = Creature.fromJSON(creature.exportJSON());
  const reloadedHidden = reloaded.neurons.find((n) => n.type === "hidden")!;
  assertEquals(newbornGraceRemaining(reloadedHidden), 2);
});
