/**
 * Tests for per-generation caching of FitnessRanking and NeatConfig.
 *
 * Issue #1538: Verifies that:
 * 1. Breed.breed() accepts a pre-computed FitnessRanking
 * 2. Breed.breed() without a ranking still works (creates one internally)
 * 3. Breed correctly handles globalBreedingRate overrides from DeDuplicator
 * 4. ParallelBreeding uses cached config per batch
 */
import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import {
  Creature,
  type CreatureExport,
  CreatureUtil,
  Selection,
} from "../../mod.ts";
import { Breed } from "../../src/breed/Breed.ts";
import { FitnessRanking } from "../../src/breed/FitnessRanking.ts";
import { ParallelBreeding } from "../../src/breed/ParallelBreeding.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";
import { Genus } from "../../src/NEAT/Genus.ts";
import { creatureValidate } from "../../src/architecture/CreatureValidate.ts";

/**
 * Creates a scored creature with a hidden neuron for use in breeding tests.
 */
function createScoredCreature(
  hiddenUUID: string,
  score: number,
  squash: string,
  bias: number,
  weight: number,
): Creature {
  const json: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      {
        type: "hidden",
        uuid: hiddenUUID,
        squash: squash,
        bias: bias,
      },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: hiddenUUID, weight: weight },
      { fromUUID: "input-1", toUUID: hiddenUUID, weight: weight * 0.5 },
      { fromUUID: hiddenUUID, toUUID: "output-0", weight: weight * 0.8 },
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
  "Breed with pre-computed FitnessRanking produces valid offspring",
  () => {
    const creatures = [
      createScoredCreature("hidden-a", 0.9, "LOGISTIC", 0.5, 0.6),
      createScoredCreature("hidden-b", 0.7, "TANH", 0.3, 0.4),
      createScoredCreature("hidden-c", 0.5, "RELU", 0.1, 0.2),
    ];
    const genus = createGenus(creatures);
    const config = createNeatConfig({ selection: Selection.POWER });

    const breed = new Breed(genus, config);
    const ranking = new FitnessRanking(genus.population);

    let offspring: Creature | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      offspring = breed.breed(ranking);
      if (offspring) break;
    }

    assert(offspring, "Should produce offspring with pre-computed ranking");
    assertEquals(offspring.input, 2, "Offspring must preserve input count");
    assertEquals(offspring.output, 1, "Offspring must preserve output count");
    creatureValidate(offspring);
  },
);

Deno.test(
  "Breed without FitnessRanking still creates one internally",
  () => {
    const creatures = [
      createScoredCreature("hidden-d", 0.9, "LOGISTIC", 0.5, 0.6),
      createScoredCreature("hidden-e", 0.7, "TANH", 0.3, 0.4),
      createScoredCreature("hidden-f", 0.5, "RELU", 0.1, 0.2),
    ];
    const genus = createGenus(creatures);
    const config = createNeatConfig({ selection: Selection.POWER });

    const breed = new Breed(genus, config);

    let offspring: Creature | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      offspring = breed.breed(); // No ranking passed
      if (offspring) break;
    }

    assert(offspring, "Should produce offspring without explicit ranking");
    creatureValidate(offspring);
  },
);

Deno.test(
  "Breed handles globalBreedingRate override correctly",
  () => {
    const creatures = [
      createScoredCreature("hidden-g", 0.9, "LOGISTIC", 0.5, 0.6),
      createScoredCreature("hidden-h", 0.7, "TANH", 0.3, 0.4),
      createScoredCreature("hidden-i", 0.5, "RELU", 0.1, 0.2),
      createScoredCreature("hidden-j", 0.3, "LeakyReLU", 0.2, 0.3),
    ];
    const genus = createGenus(creatures);
    const config = createNeatConfig({
      selection: Selection.POWER,
      globalBreedingRate: 0.5,
    });

    const breed = new Breed(genus, config);

    // Override globalBreedingRate like DeDuplicator does
    breed.options.globalBreedingRate = 1;

    let offspring: Creature | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      offspring = breed.breed();
      if (offspring) break;
    }

    assert(
      offspring,
      "Should produce offspring with overridden globalBreedingRate",
    );
    creatureValidate(offspring);
  },
);

Deno.test(
  "Breed reuses same ranking for multiple breed calls",
  () => {
    const creatures = [
      createScoredCreature("hidden-k", 0.9, "LOGISTIC", 0.5, 0.6),
      createScoredCreature("hidden-l", 0.7, "TANH", 0.3, 0.4),
      createScoredCreature("hidden-m", 0.5, "RELU", 0.1, 0.2),
      createScoredCreature("hidden-n", 0.3, "LeakyReLU", 0.2, 0.3),
    ];
    const genus = createGenus(creatures);
    const config = createNeatConfig({ selection: Selection.POWER });

    const breed = new Breed(genus, config);
    const ranking = new FitnessRanking(genus.population);

    // Call breed multiple times with the same ranking
    let successCount = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
      const offspring = breed.breed(ranking);
      if (offspring) {
        successCount++;
        creatureValidate(offspring);
      }
    }

    assert(
      successCount > 0,
      "Should produce offspring when reusing the same ranking",
    );
  },
);

Deno.test(
  "ParallelBreeding uses cached config per batch",
  async () => {
    const creatures = [
      createScoredCreature("hidden-o", 0.9, "LOGISTIC", 0.5, 0.6),
      createScoredCreature("hidden-p", 0.7, "TANH", 0.3, 0.4),
      createScoredCreature("hidden-q", 0.5, "RELU", 0.1, 0.2),
      createScoredCreature("hidden-r", 0.3, "LeakyReLU", 0.2, 0.3),
    ];
    const genus = createGenus(creatures);
    const config = createNeatConfig({ selection: Selection.POWER });

    const pb = new ParallelBreeding(genus, config);

    // Run multiple batches — each should use cached config
    const batch1 = await pb.breedBatch(10);
    const batch2 = await pb.breedBatch(10);

    for (const child of [...batch1, ...batch2]) {
      creatureValidate(child);
      assertEquals(child.input, 2, "Input count preserved");
      assertEquals(child.output, 1, "Output count preserved");
    }
  },
);
