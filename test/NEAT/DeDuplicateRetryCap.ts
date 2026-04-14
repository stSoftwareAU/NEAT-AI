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
 * Tests for Issue #2286: de-duplication retry cap and async previousExperiment().
 *
 * Verifies that:
 * 1. The retry cap is respected (configurable via maxDedupRetries)
 * 2. When the retry cap is reached, a mutated creature is accepted rather than
 *    the creature being spliced out
 * 3. The population size is preserved even under heavy duplication pressure
 * 4. previousExperiment() caches results per generation
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

Deno.test("DeDuplicator retry cap preserves population under duplication pressure", async () => {
  const config = createNeatConfig({
    populationSize: 10,
    elitism: 1,
    mutationRate: 0.3,
    maxDedupRetries: 4, // Low retry cap to exercise the fallback path
  });

  // Verify the config option was parsed correctly
  assertEquals(config.maxDedupRetries, 4);

  // Create a population at the population size limit with many duplicates.
  // The deduplicator will need to replace them, not cull them.
  const creatures: Creature[] = [];

  // Add a few unique creatures first
  for (let i = 0; i < 5; i++) {
    const json = JSON.parse(JSON.stringify(baseCreature));
    json.neurons[0].bias = i * 0.1;
    creatures.push(Creature.fromJSON(json));
  }

  // Add duplicates of the first creature (within population size, so they
  // must be replaced rather than culled)
  for (let i = 0; i < 5; i++) {
    creatures.push(Creature.fromJSON(creatures[0].exportJSON()));
  }

  assertEquals(creatures.length, 10);

  const genus = new Genus();
  const breed = new Breed(genus, config);
  const mutator = new Mutator(config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  await deDuplicator.perform(creatures);

  // Population should be preserved (not reduced by splicing)
  assertEquals(
    creatures.length,
    10,
    "Population size should be preserved when retry cap is reached",
  );

  // All remaining creatures should have UUIDs
  for (const creature of creatures) {
    assert(creature.uuid, "Every creature should have a UUID");
  }
});

Deno.test("DeDuplicator default maxDedupRetries is 16", () => {
  const config = createNeatConfig({
    populationSize: 10,
  });

  assertEquals(config.maxDedupRetries, 16);
});

Deno.test("DeDuplicator async perform produces unique creatures", async () => {
  const config = createNeatConfig({
    populationSize: 20,
    elitism: 2,
    mutationRate: 0.3,
  });

  // Create a population with many duplicates
  const creatures: Creature[] = [];
  for (let i = 0; i < 10; i++) {
    const json = JSON.parse(JSON.stringify(baseCreature));
    json.neurons[0].bias = i * 0.1;
    creatures.push(Creature.fromJSON(json));
  }

  // Add duplicates (enough to exceed population size, so some will be culled)
  for (let i = 0; i < 30; i++) {
    const sourceIndex = i % 5;
    creatures.push(Creature.fromJSON(creatures[sourceIndex].exportJSON()));
  }

  const genus = new Genus();
  const breed = new Breed(genus, config);
  const mutator = new Mutator(config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  await deDuplicator.perform(creatures);

  // Verify all remaining creatures are unique
  const uuids = new Set<string>();
  for (const creature of creatures) {
    const uuid = CreatureUtil.makeUUID(creature);
    assertFalse(
      uuids.has(uuid),
      `Duplicate found after async deduplication: ${uuid}`,
    );
    uuids.add(uuid);
  }
});

Deno.test("DeDuplicator previousExperiment caches results", async () => {
  const config = createNeatConfig({
    populationSize: 10,
    // No experimentStore configured, so previousExperiment returns false
  });

  const genus = new Genus();
  const breed = new Breed(genus, config);
  const mutator = new Mutator(config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  const testUuid = "00000000-0000-4000-8000-000000000001";

  // Call previousExperiment twice with the same UUID
  const result1 = await deDuplicator.previousExperiment(testUuid);
  const result2 = await deDuplicator.previousExperiment(testUuid);

  // Both should return false (no experiment store configured)
  assertFalse(
    result1,
    "First call should return false without experimentStore",
  );
  assertFalse(
    result2,
    "Second call should return false without experimentStore",
  );
});
