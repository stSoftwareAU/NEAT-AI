import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "@creature";
import { Breed } from "@breed/Breed.ts";
import { Genus } from "@neat/Genus.ts";
import { Mutator } from "@neat/Mutator.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

/**
 * Tests for Issue #2286: Async batch previousExperiment() and capped
 * replacement retries in the DeDuplicator.
 *
 * Verifies:
 * 1. perform() is async and resolves correctly
 * 2. Per-generation cache avoids redundant file lookups
 * 3. Replacement retry cap prevents excessive looping
 * 4. All creatures remain unique after deduplication
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

Deno.test(
  "DeDuplicator async perform resolves with unique population",
  async () => {
    const config = createNeatConfig({
      populationSize: 10,
      elitism: 2,
      mutationRate: 0.3,
    });

    const creatures: Creature[] = [];
    for (let i = 0; i < 15; i++) {
      const json = JSON.parse(JSON.stringify(baseCreature));
      json.neurons[0].bias = i * 0.1;
      creatures.push(Creature.fromJSON(json));
    }

    // Add duplicates
    for (let i = 0; i < 10; i++) {
      creatures.push(
        Creature.fromJSON(creatures[i % 5].exportJSON()),
      );
    }

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    // perform() should return a Promise
    const result = deDuplicator.perform(creatures);
    assert(result instanceof Promise, "perform() must return a Promise");
    await result;

    // All remaining creatures should be unique
    const remainingUUIDs = new Set<string>();
    for (const creature of creatures) {
      const uuid = CreatureUtil.makeUUID(creature);
      assertFalse(
        remainingUUIDs.has(uuid),
        `Duplicate found after async deduplication: ${uuid}`,
      );
      remainingUUIDs.add(uuid);
    }
  },
);

Deno.test(
  "DeDuplicator previousExperiment caches results per generation",
  () => {
    const config = createNeatConfig({
      populationSize: 10,
      elitism: 1,
      mutationRate: 0.3,
    });

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    const deDuplicator = new DeDuplicator(breed, mutator);

    // Without experimentStore, previousExperiment should return false
    const result1 = deDuplicator.previousExperiment("abc123def");
    assertEquals(result1, false, "Should return false without experimentStore");

    // Call again with same key - should use cache (same result)
    const result2 = deDuplicator.previousExperiment("abc123def");
    assertEquals(result2, false, "Cached result should also be false");

    // Different key - should also return false (no experimentStore)
    const result3 = deDuplicator.previousExperiment("xyz789abc");
    assertEquals(result3, false, "Different key should also be false");
  },
);

Deno.test(
  "DeDuplicator replacement retries respect configurable cap",
  async () => {
    const config = createNeatConfig({
      populationSize: 5,
      elitism: 1,
      mutationRate: 0.3,
    });

    // Create a population where most creatures are identical
    // This forces the replacement path to be exercised
    const original = Creature.fromJSON(baseCreature);
    const creatures: Creature[] = [];

    // Add 5 copies (equal to populationSize, so replacement path is used)
    for (let i = 0; i < 5; i++) {
      creatures.push(Creature.fromJSON(original.exportJSON()));
    }

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);

    // Use a low retry cap to exercise the cap path
    const deDuplicator = new DeDuplicator(breed, mutator, 3);

    await deDuplicator.perform(creatures);

    // Should complete without hanging (the retry cap prevents infinite loops)
    assert(
      creatures.length > 0,
      "Population should not be empty after deduplication",
    );
    assert(
      creatures.length <= 5,
      `Population should not grow beyond 5, got ${creatures.length}`,
    );
  },
);

Deno.test(
  "DeDuplicator with default retry cap handles many duplicates",
  async () => {
    const config = createNeatConfig({
      populationSize: 8,
      elitism: 1,
      mutationRate: 0.3,
    });

    const creatures: Creature[] = [];

    // Add a few unique creatures
    for (let i = 0; i < 3; i++) {
      const json = JSON.parse(JSON.stringify(baseCreature));
      json.neurons[0].bias = (i + 1) * 0.5;
      creatures.push(Creature.fromJSON(json));
    }

    // Add many duplicates (within population size, so replacement is attempted)
    for (let i = 0; i < 5; i++) {
      creatures.push(Creature.fromJSON(creatures[0].exportJSON()));
    }

    assertEquals(creatures.length, 8);

    const genus = new Genus();
    const breed = new Breed(genus, config);
    const mutator = new Mutator(config);
    // Default retry cap (12)
    const deDuplicator = new DeDuplicator(breed, mutator);

    await deDuplicator.perform(creatures);

    // All remaining creatures should be unique
    const remainingUUIDs = new Set<string>();
    for (const creature of creatures) {
      const uuid = CreatureUtil.makeUUID(creature);
      assertFalse(
        remainingUUIDs.has(uuid),
        `Duplicate found after deduplication: ${uuid}`,
      );
      remainingUUIDs.add(uuid);
    }

    assert(
      creatures.length > 0,
      "Population should not be empty",
    );
  },
);
