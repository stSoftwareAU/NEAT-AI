/**
 * Off-creature lineage for archive provenance (Issue #3929).
 *
 * Lineage is run infrastructure: it must be available to the archive and
 * invisible to the creature export, because a creature's `uuid` is a content
 * hash and anything persisted beside it that is not content is a liability.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  lineageOf,
  recordDerivedFrom,
  recordLineage,
} from "@archive/CreatureLineage.ts";

/** A distinct creature with a settled UUID. */
function makeCreature(inputs: number): Creature {
  const creature = new Creature(inputs, 1);
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("creature lineage - a creature with no recorded parents has none", () => {
  assertEquals(lineageOf(makeCreature(2)), []);
});

Deno.test("creature lineage - both parents are recorded by UUID", () => {
  const mother = makeCreature(2);
  const father = makeCreature(3);
  const child = makeCreature(4);

  recordLineage(child, mother, father);

  assertEquals(
    [...lineageOf(child)].sort(),
    [mother.uuid!, father.uuid!].sort(),
  );
});

Deno.test("creature lineage - an unhashed parent is materialised, not dropped", () => {
  // Issue #4004 changed this rule. Under Issue #3929 a parent whose content
  // hash had not been computed yet was skipped, which is how a two-parent
  // record ended up naming one parent. The hash is derivable from the parent
  // in hand, so it is derived — the link is real, not a guess.
  const mother = makeCreature(2);
  const father = new Creature(3, 1);
  delete father.uuid;
  const child = makeCreature(4);

  recordLineage(child, mother, father);

  assertEquals(lineageOf(child).length, 2, "both parents must be named");
  assert(lineageOf(child).includes(mother.uuid!));
  assert(
    lineageOf(child).includes(CreatureUtil.makeUUID(father)),
    "the materialised hash must be the one the father is archived under",
  );
  assert(
    !lineageOf(child).includes("unknown"),
    "a missing parent must read as missing",
  );
});

Deno.test("creature lineage - a genuinely absent parent is a gap, not a guess", () => {
  const mother = makeCreature(2);
  const child = makeCreature(4);

  recordLineage(child, mother, undefined);

  assertEquals(lineageOf(child), [mother.uuid!]);
});

Deno.test("creature lineage - the mutate-a-clone path names the pre-mutation identity", () => {
  const parent = makeCreature(2);
  const child = makeCreature(3);

  recordDerivedFrom(child, parent.uuid!);

  assertEquals(lineageOf(child), [parent.uuid!]);
});

Deno.test("creature lineage - a derivation never overwrites recorded parents", () => {
  // A bred offspring names the two scored parents it was crossed from. Mutating
  // it in place must not trade those for the identity of the un-mutated
  // offspring, which was never evaluated and is in no archive.
  const mother = makeCreature(2);
  const father = makeCreature(3);
  const child = makeCreature(4);
  recordLineage(child, mother, father);

  recordDerivedFrom(child, makeCreature(5).uuid!);

  assertEquals(
    [...lineageOf(child)].sort(),
    [mother.uuid!, father.uuid!].sort(),
  );
});

Deno.test("creature lineage - recording no identifiable parent leaves no entry", () => {
  const child = makeCreature(2);
  recordLineage(child, undefined);
  assertEquals(lineageOf(child), []);
});

Deno.test("creature lineage - never reaches the creature export", () => {
  const mother = makeCreature(2);
  const child = makeCreature(2);
  const uuidBefore = child.uuid;

  recordLineage(child, mother);

  const exported = JSON.stringify(child.exportJSON());
  assert(!exported.includes(mother.uuid!), `lineage leaked: ${exported}`);
  assert(!exported.includes("parents"), `lineage leaked: ${exported}`);
  // Recording lineage is not a content change, so identity must not move.
  assertEquals(child.uuid, uuidBefore);
});
