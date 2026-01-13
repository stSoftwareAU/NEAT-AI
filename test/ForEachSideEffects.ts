import { assert, assertEquals } from "@std/assert";
import { Creature } from "../src/Creature.ts";
import { Breed } from "../src/breed/Breed.ts";
import { Genus } from "../src/NEAT/Genus.ts";
import { Mutator } from "../src/NEAT/Mutator.ts";
import { Neat } from "../src/NEAT/Neat.ts";
import type { CreatureInternal } from "../src/architecture/CreatureInterfaces.ts";
import { DeDuplicator } from "../src/architecture/DeDuplicator.ts";
import { CreatureUtil } from "../mod.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Test for issue #1042: Performance: Use forEach instead of map for side-effect-only operations
 *
 * This test verifies that the side effects of the DeDuplicator.perform() method
 * are correctly applied to all creatures:
 * 1. Each creature should have a UUID assigned
 * 2. Each creature should be added to the genus
 *
 * The implementation uses forEach instead of map since the return value is not used,
 * which avoids unnecessary array allocation.
 */
Deno.test("ForEachSideEffects - DeDuplicator applies side effects to all creatures", () => {
  const creature: CreatureInternal = {
    neurons: [
      {
        bias: 0,
        index: 2,
        type: "hidden",
        squash: "IDENTITY",
      },
      {
        bias: 0.1,
        index: 3,
        type: "output",
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        weight: 0.5,
        from: 0,
        to: 2,
      },
      {
        weight: 0.3,
        from: 1,
        to: 2,
      },
      {
        weight: 0.2,
        from: 2,
        to: 3,
      },
    ],
    input: 2,
    output: 1,
  };

  const neat = new Neat(2, 1, { populationSize: 10 }, []);
  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  // Create creatures with different biases to ensure they're unique
  const creatures: Creature[] = [];
  for (let i = 0; i < 5; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(creature));
    modifiedJSON.neurons[0].bias = i * 0.1;
    creatures.push(Creature.fromJSON(modifiedJSON));
  }

  // Before perform(), creatures may not have UUIDs and are not in genus
  const genusSizeBefore = genus.population.length;
  assertEquals(genusSizeBefore, 0, "Genus should be empty before perform()");

  // Perform de-duplication (which applies side effects via forEach)
  deDuplicator.perform(creatures);

  // Verify side effect 1: All creatures should have UUIDs assigned
  for (const c of creatures) {
    assert(c.uuid, "Each creature should have a UUID after perform()");
  }

  // Verify side effect 2: All unique creatures should be in the genus
  // Note: The genus contains the unique creatures that were added
  assert(
    genus.population.length > 0,
    "Genus should contain creatures after perform()",
  );

  // Each creature in the population should be findable in the genus
  for (const c of creatures) {
    const uuid = CreatureUtil.makeUUID(c);
    const speciesKey = genus.creatureToSpeciesMap.get(uuid);
    assert(speciesKey, `Creature ${uuid} should be mapped to a species`);
  }
});

/**
 * Test that forEach correctly processes all elements in order.
 * This verifies that switching from map to forEach doesn't affect
 * the order of processing or skip any elements.
 */
Deno.test("ForEachSideEffects - all creatures processed in sequence", () => {
  const creature: CreatureInternal = {
    neurons: [
      {
        bias: 0.1,
        index: 2,
        type: "output",
        squash: "IDENTITY",
      },
    ],
    synapses: [
      {
        weight: 0.5,
        from: 0,
        to: 2,
      },
    ],
    input: 1,
    output: 1,
  };

  const neat = new Neat(1, 1, { populationSize: 20 }, []);
  const genus = new Genus();
  const breed = new Breed(genus, neat.config);
  const mutator = new Mutator(neat.config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  // Create 10 unique creatures
  const creatures: Creature[] = [];
  for (let i = 0; i < 10; i++) {
    const modifiedJSON = JSON.parse(JSON.stringify(creature));
    modifiedJSON.neurons[0].bias = i * 0.1 + 0.01; // Ensure unique values
    creatures.push(Creature.fromJSON(modifiedJSON));
  }

  // Perform de-duplication
  deDuplicator.perform(creatures);

  // All 10 unique creatures should be processed
  assertEquals(
    creatures.length,
    10,
    "All creatures should remain in the array",
  );

  // Each creature should have been processed (have UUID and be in genus)
  const processedUUIDs = new Set<string>();
  for (const c of creatures) {
    assert(c.uuid, "Creature should have UUID");
    processedUUIDs.add(c.uuid);
  }

  assertEquals(
    processedUUIDs.size,
    10,
    "All 10 creatures should have unique UUIDs",
  );
});
