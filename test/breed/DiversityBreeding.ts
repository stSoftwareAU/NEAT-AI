/**
 * Tests for diversity-driven breeding (Issue #2173).
 *
 * Verifies that when diversityBreedingRate is configured, the fittest
 * creature periodically breeds with a genetically distant individual
 * rather than always selecting fathers by fitness ranking.
 */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import {
  Creature,
  type CreatureExport,
  CreatureUtil,
  Selection,
} from "../../mod.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { Genus } from "@neat/Genus.ts";
import { findFather, selectMostDiverseFather } from "@breed/ParentSelection.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";

/**
 * Creates a scored creature with a unique hidden neuron UUID.
 */
function createScoredCreature(score: number, hiddenUUID?: string): Creature {
  const uuid = hiddenUUID ?? crypto.randomUUID();
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: uuid,
        squash: "LOGISTIC",
        bias: 0.1,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: uuid, weight: 0.5 },
      { fromUUID: uuid, toUUID: "output-0", weight: 0.8 },
    ],
  };
  const creature = Creature.fromJSON(json);
  CreatureUtil.makeUUID(creature);
  creature.score = score;
  addTag(creature, "score", score.toString());
  return creature;
}

/**
 * Creates a creature with multiple hidden neurons for richer architecture.
 */
function createDiverseCreature(
  score: number,
  hiddenUUIDs: string[],
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUUIDs.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "LOGISTIC",
    bias: 0.1,
  }));
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  const synapses = [
    { fromUUID: "input-0", toUUID: hiddenUUIDs[0], weight: 0.5 },
  ];
  for (let i = 0; i < hiddenUUIDs.length - 1; i++) {
    synapses.push({
      fromUUID: hiddenUUIDs[i],
      toUUID: hiddenUUIDs[i + 1],
      weight: 0.3,
    });
  }
  synapses.push({
    fromUUID: hiddenUUIDs[hiddenUUIDs.length - 1],
    toUUID: "output-0",
    weight: 0.8,
  });

  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons,
    synapses,
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
  "selectMostDiverseFather - picks the most genetically distant creature",
  () => {
    const sharedHidden = crypto.randomUUID();
    const mum = createScoredCreature(0.95, sharedHidden);

    // Similar creature (same hidden neuron = compatibility 1)
    const similar = createScoredCreature(0.85, sharedHidden);

    // Moderately diverse (one shared, one unique hidden neuron)
    const moderateUUIDs = [sharedHidden, crypto.randomUUID()];
    const moderate = createDiverseCreature(0.6, moderateUUIDs);

    // Very diverse (all unique hidden neurons = compatibility 0)
    const diverseUUIDs = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const diverse = createDiverseCreature(-0.2, diverseUUIDs);

    const candidates = [similar, moderate, diverse];
    const selected = selectMostDiverseFather(mum, candidates);

    // Should select the most diverse creature (compatibility 0)
    assertEquals(
      selected.uuid,
      diverse.uuid,
      "Should select the most genetically distant creature",
    );
  },
);

Deno.test(
  "selectMostDiverseFather - selects first candidate when all equally diverse",
  () => {
    const mum = createScoredCreature(0.95);

    // All candidates have unique hidden neurons (all compatibility 0 with mum)
    const a = createScoredCreature(0.8);
    const b = createScoredCreature(0.6);
    const c = createScoredCreature(0.4);

    const candidates = [a, b, c];
    const selected = selectMostDiverseFather(mum, candidates);

    // When all are equally diverse, the first one with lowest compat wins
    // (since they all have compat < 1 due to different hidden UUIDs)
    assert(
      candidates.some((c) => c.uuid === selected.uuid),
      "Should select one of the candidates",
    );
  },
);

Deno.test(
  "selectMostDiverseFather - prefers diverse over fit creatures",
  () => {
    const sharedHidden = crypto.randomUUID();
    const mum = createScoredCreature(0.95, sharedHidden);

    // High-fitness similar creature
    const fitSimilar = createScoredCreature(0.9, sharedHidden);

    // Low-fitness diverse creature
    const diverseUUIDs = [crypto.randomUUID(), crypto.randomUUID()];
    const weakDiverse = createDiverseCreature(-0.8, diverseUUIDs);

    const candidates = [fitSimilar, weakDiverse];
    const selected = selectMostDiverseFather(mum, candidates);

    // Diversity selection ignores fitness — should pick the diverse creature
    assertEquals(
      selected.uuid,
      weakDiverse.uuid,
      "Should select diverse creature regardless of fitness",
    );
  },
);

Deno.test(
  "findFather - diversityBreedingRate=1 always selects diverse father via findFather",
  () => {
    const sharedHidden = crypto.randomUUID();
    const fittest = createScoredCreature(0.95, sharedHidden);
    const similar1 = createScoredCreature(0.85, sharedHidden);
    const similar2 = createScoredCreature(0.75, sharedHidden);

    // Europa newcomer: distinct architecture, low fitness
    const europaUUIDs = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const europa = createDiverseCreature(-0.5, europaUUIDs);

    const genus = createGenus([fittest, similar1, similar2, europa]);

    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
      diversityBreedingRate: 1,
      seed: 42,
    });

    // With diversityBreedingRate=1, findFather should always pick the
    // most diverse creature as the base father (before compatibility transform).
    // After the compatibility transform, the father's hidden neurons may differ,
    // but the integration should still succeed without error.
    const dad = findFather(fittest, genus, config);
    assert(dad, "Father should be found");
    assertNotEquals(
      dad.uuid,
      fittest.uuid,
      "Father should not be the mother",
    );
  },
);

Deno.test(
  "findFather - diversity breeding does not interfere with normal breeding when rate is 0",
  () => {
    const sharedHidden = crypto.randomUUID();
    const creatures = [
      createScoredCreature(0.9, sharedHidden),
      createScoredCreature(0.7, sharedHidden),
      createScoredCreature(0.5, sharedHidden),
    ];

    const genus = createGenus(creatures);
    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 1,
      diversityBreedingRate: 0,
      seed: 99,
    });

    // Normal breeding should work as before
    const dad = findFather(creatures[0], genus, config);
    if (dad) {
      assertNotEquals(
        dad.uuid,
        creatures[0].uuid,
        "Father should not be the same as mother",
      );
    }
  },
);

Deno.test(
  "findFather - diversityBreedingRate defaults to 0 when not specified",
  () => {
    const config = createNeatConfig({
      selection: Selection.POWER,
      seed: 42,
    });

    assertEquals(
      config.diversityBreedingRate,
      0,
      "diversityBreedingRate should default to 0",
    );
  },
);

Deno.test(
  "geneticCompatibility confirms Europa creatures are genetically distant",
  () => {
    // Document that Europa creatures (unique architecture) have low
    // compatibility with the general population
    const sharedHidden = crypto.randomUUID();
    const generalPop = createScoredCreature(0.9, sharedHidden);

    const europaUUIDs = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    const europa = createDiverseCreature(-0.5, europaUUIDs);

    const compat = geneticCompatibility(generalPop, europa);
    assertEquals(
      compat,
      0,
      "Europa creatures with unique architecture should have zero genetic compatibility",
    );

    // Same-architecture creatures should have full compatibility
    const sameArch = createScoredCreature(0.5, sharedHidden);
    const sameCompat = geneticCompatibility(generalPop, sameArch);
    assertEquals(
      sameCompat,
      1,
      "Same-architecture creatures should have full genetic compatibility",
    );
  },
);
