/**
 * The mutate-a-clone path records the parent it was derived from (Issue #4004).
 *
 * A clone of a scored creature, mutated in place, was most of the population
 * and reached the evaluation archive naming nobody — indistinguishable from a
 * seed, an elite or a random immigrant.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Mutator } from "@neat/Mutator.ts";
import { lineageOf, recordLineage } from "@archive/CreatureLineage.ts";
import {
  createSeededRng,
  resetGlobalRandomNumberGeneratorForTesting,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import { withRngTestLock } from "../_rngTestLock.ts";

/** A mutator that mutates everything it is given. */
function alwaysMutate(): Mutator {
  return new Mutator(
    createNeatConfig({
      populationSize: 10,
      mutationRate: 1.0,
      mutationAmount: 4,
    }),
  );
}

/** A creature big enough that four mutation attempts change it. */
function subject(): Creature {
  const creature = new Creature(3, 2, { layers: [{ count: 6 }] });
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("mutator lineage - a mutated clone names the creature it came from", () => {
  const parent = subject();
  const clone = parent.shallowClone();
  const parentUuid = parent.uuid!;
  assertEquals(clone.uuid, parentUuid, "a clone starts as its source");

  alwaysMutate().mutate([clone]);

  assert(clone.uuid !== parentUuid, "the clone must have been mutated");
  assertEquals(
    lineageOf(clone),
    [parentUuid],
    "the pre-mutation identity is the parent",
  );
});

Deno.test("mutator lineage - an unevaluated offspring keeps its crossover parents", () => {
  // A bred offspring has a UUID but no score, so that identity is in no
  // archive. Naming it would trade two links that resolve for one that cannot.
  const mother = subject();
  const father = subject();
  const offspring = subject();
  recordLineage(offspring, mother, father);
  assertEquals(offspring.score, undefined);

  alwaysMutate().mutate([offspring]);

  assertEquals(
    [...lineageOf(offspring)].sort(),
    [mother.uuid!, father.uuid!].sort(),
  );
});

Deno.test("mutator lineage - an evaluated creature displaces an older link", () => {
  // Once the creature has taken a finite score it is in the archive under its
  // own UUID, so that is the nearest ancestor a consumer can join to.
  const grandparent = subject();
  const creature = subject();
  recordLineage(creature, grandparent);
  creature.score = 0.5;
  const evaluatedUuid = creature.uuid!;

  alwaysMutate().mutate([creature]);

  assertEquals(lineageOf(creature), [evaluatedUuid]);
});

Deno.test("mutator lineage - an unchanged creature records nothing", async () => {
  // `mutationRate` is the per-creature draw. Pinning the generator to a stream
  // that opens above the configured floor makes "this creature was skipped" a
  // fact rather than a probability.
  await withRngTestLock(() => {
    setRandomNumberGenerator(createSeededRng(3));
    const creature = subject();
    const before = creature.uuid;
    const mutator = new Mutator(
      createNeatConfig({ populationSize: 10, mutationRate: 0.002 }),
    );

    mutator.mutate([creature]);

    assertEquals(creature.uuid, before, "nothing was mutated");
    assertEquals(
      lineageOf(creature),
      [],
      "a creature that did not change is not derived from itself",
    );
    resetGlobalRandomNumberGeneratorForTesting();
  });
});
