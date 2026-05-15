import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { Breed } from "@breed/Breed.ts";
import { Genus } from "@neat/Genus.ts";
import { Mutator } from "@neat/Mutator.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import type { FitnessRanking } from "@breed/FitnessRanking.ts";

/**
 * Issue #2664: DeDuplicator.replaceDuplicateCreature must not propagate a
 * TopologyError thrown by Breed.breed() / Offspring.breed() (e.g. when the
 * bred offspring contains a duplicate neuron id and fails creatureValidate).
 * Instead the dedup pass should treat the failed breed attempt as if breed
 * returned undefined and fall back to mutation, preserving the population.
 */

const baseCreature: CreatureInternal = {
  neurons: [
    { bias: 0, index: 3, type: "hidden", squash: "IDENTITY" },
    { bias: 0.1, index: 4, type: "output", squash: "IDENTITY" },
  ],
  synapses: [
    { weight: 0.5, from: 0, to: 3 },
    { weight: 0.3, from: 1, to: 3 },
    { weight: 0.7, from: 2, to: 3 },
    { weight: 0.4, from: 3, to: 4 },
  ],
  input: 3,
  output: 1,
};

/**
 * Test double: a Breed whose breed() always throws a TopologyError that
 * mimics the duplicate-neuron-id failure observed in production (Issue #2664).
 */
class TopologyErrorBreed extends Breed {
  breedCallCount = 0;

  override breed(_populationRanking?: FitnessRanking): Creature | undefined {
    this.breedCallCount++;
    throw new TopologyError(
      "[Offspring] Forward-only offspring failed creatureValidate after breed: 564544998) duplicate neuron id: 564544998",
      "INVALID_CONNECTION",
    );
  }
}

Deno.test(
  "DeDuplicator recovers when Breed.breed throws TopologyError (Issue #2664)",
  async () => {
    const config = createNeatConfig({
      populationSize: 10,
      elitism: 1,
      mutationRate: 0.5,
      maxDedupRetries: 4,
    });

    // Build a population at populationSize with many duplicates so the
    // DeDuplicator is forced to call replaceDuplicateCreature (not cull).
    const creatures: Creature[] = [];
    for (let i = 0; i < 5; i++) {
      const json = JSON.parse(JSON.stringify(baseCreature));
      json.neurons[0].bias = i * 0.1;
      creatures.push(Creature.fromJSON(json));
    }
    for (let i = 0; i < 5; i++) {
      creatures.push(Creature.fromJSON(creatures[0].exportJSON()));
    }

    assertEquals(creatures.length, 10);

    const genus = new Genus();
    const breed = new TopologyErrorBreed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    // The crucial assertion: perform() must not throw even though every
    // breed() call raises a TopologyError. The mutation fallback must take
    // over and preserve the population.
    await deDuplicator.perform(creatures);

    assert(
      breed.breedCallCount > 0,
      "TopologyErrorBreed.breed should have been invoked at least once",
    );

    assertEquals(
      creatures.length,
      10,
      "Population size should be preserved even when Breed.breed throws TopologyError",
    );

    for (const creature of creatures) {
      assert(creature.uuid, "Every creature should have a UUID after dedup");
    }
  },
);
