/**
 * Tests for the shared parent selection utility.
 * Issue #1392: DRY - Extract duplicated selectParent/getDad logic
 * from Breed.ts and ParallelBreeding.ts into shared functions.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import {
  Creature,
  type CreatureExport,
  CreatureUtil,
  Selection,
} from "../../mod.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Genus } from "../../src/NEAT/Genus.ts";
import { findFather, selectParent } from "../../src/breed/ParentSelection.ts";
import { FitnessRanking } from "../../src/breed/FitnessRanking.ts";

function createScoredCreature(score: number): Creature {
  const hiddenUUID = crypto.randomUUID();
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: hiddenUUID,
        squash: "LOGISTIC",
        bias: 0.1,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: hiddenUUID, weight: 0.5 },
      { fromUUID: hiddenUUID, toUUID: "output-0", weight: 0.8 },
    ],
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  addTag(creature, "score", score.toString());
  return creature;
}

function createGenus(creatures: Creature[]): Genus {
  const genus = new Genus();
  for (const creature of creatures) {
    genus.addCreature(creature);
  }
  return genus;
}

Deno.test(
  "selectParent - returns a creature from the ranking with POWER selection",
  () => {
    const creatures = [
      createScoredCreature(0.9),
      createScoredCreature(0.7),
      createScoredCreature(0.5),
    ];

    const ranking = new FitnessRanking(creatures);
    const config = createNeatConfig({ selection: Selection.POWER });

    const parent = selectParent(ranking, config);
    assert(parent, "Should select a parent");
    assert(
      creatures.some((c) => c.uuid === parent.uuid),
      "Selected parent should be from the population",
    );
  },
);

Deno.test(
  "selectParent - returns a creature with FITNESS_PROPORTIONATE selection",
  () => {
    const creatures = [
      createScoredCreature(0.9),
      createScoredCreature(0.7),
      createScoredCreature(0.5),
    ];

    const ranking = new FitnessRanking(creatures);
    const config = createNeatConfig({
      selection: Selection.FITNESS_PROPORTIONATE,
    });

    const parent = selectParent(ranking, config);
    assert(parent, "Should select a parent");
  },
);

Deno.test(
  "selectParent - returns a creature with TOURNAMENT selection",
  () => {
    const creatures = [
      createScoredCreature(0.9),
      createScoredCreature(0.7),
      createScoredCreature(0.5),
      createScoredCreature(0.3),
      createScoredCreature(0.1),
    ];

    const ranking = new FitnessRanking(creatures);
    const config = createNeatConfig({ selection: Selection.TOURNAMENT });

    const parent = selectParent(ranking, config);
    assert(parent, "Should select a parent");
  },
);

Deno.test("findFather - returns a compatible father from the genus", () => {
  const creatures = [
    createScoredCreature(0.9),
    createScoredCreature(0.7),
    createScoredCreature(0.5),
  ];

  const config = createNeatConfig({ selection: Selection.POWER });
  const genus = createGenus(creatures);
  const mum = creatures[0];

  const dad = findFather(mum, genus, config);
  // With only 3 creatures, we should find a father
  // (unless random selection picks the mother's UUID, but that's filtered out)
  if (dad) {
    assertNotEquals(
      dad.uuid,
      mum.uuid,
      "Father should not be the same creature as the mother",
    );
  }
});

Deno.test("findFather - returns undefined when no fathers available", () => {
  // Create a population with only one creature
  const creatures = [createScoredCreature(0.9)];

  const config = createNeatConfig({ selection: Selection.POWER });
  const genus = createGenus(creatures);
  const mum = creatures[0];

  const dad = findFather(mum, genus, config);
  assertEquals(
    dad,
    undefined,
    "Should return undefined when no fathers available",
  );
});
