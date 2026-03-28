import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { Breed } from "../../src/breed/Breed.ts";
import { Genus } from "../../src/NEAT/Genus.ts";
import { Mutator } from "../../src/NEAT/Mutator.ts";
import type { CreatureInternal } from "../../src/architecture/CreatureInterfaces.ts";
import { DeDuplicator } from "../../src/architecture/DeDuplicator.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { createNeatConfig } from "../../src/config/NeatConfig.ts";

/**
 * Tests for the bulk removal path in DeDuplicator (Issue #1477).
 * When duplicates exceed the population size, they are culled rather than
 * replaced. This exercises the in-place filter removal approach.
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

Deno.test("DeDuplicator bulk removal preserves unique creatures", () => {
  const config = createNeatConfig({
    populationSize: 10,
    elitism: 2,
    mutationRate: 0.3,
  });

  // Create a population well over the population size, with many duplicates
  const creatures: Creature[] = [];

  // Add several unique creatures by varying biases
  for (let i = 0; i < 15; i++) {
    const json = JSON.parse(JSON.stringify(baseCreature));
    json.neurons[0].bias = i * 0.1;
    json.neurons[1].bias = i * 0.05;
    creatures.push(Creature.fromJSON(json));
  }

  // Record the UUIDs of unique creatures
  const uniqueUUIDs = new Set<string>();
  for (const creature of creatures) {
    uniqueUUIDs.add(CreatureUtil.makeUUID(creature));
  }

  // Add many duplicates of the first few creatures (well beyond population size)
  for (let i = 0; i < 30; i++) {
    const sourceIndex = i % 5;
    creatures.push(
      Creature.fromJSON(creatures[sourceIndex].exportInternalJSON()),
    );
  }

  assertEquals(creatures.length, 45);

  const genus = new Genus();
  const breed = new Breed(genus, config);
  const mutator = new Mutator(config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  deDuplicator.perform(creatures);

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

  // Population should have been reduced (duplicates culled)
  assert(
    creatures.length <= 45,
    `Population should be reduced from 45, got ${creatures.length}`,
  );
});

Deno.test("DeDuplicator bulk removal handles all-duplicates correctly", () => {
  const config = createNeatConfig({
    populationSize: 5,
    elitism: 1,
    mutationRate: 0.3,
  });

  // Create a population where most creatures are identical
  const creatures: Creature[] = [];
  const original = Creature.fromJSON(baseCreature);

  // Add 20 copies of the same creature
  for (let i = 0; i < 20; i++) {
    creatures.push(Creature.fromJSON(original.exportInternalJSON()));
  }

  const genus = new Genus();
  const breed = new Breed(genus, config);
  const mutator = new Mutator(config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  deDuplicator.perform(creatures);

  // Should have reduced the population significantly
  assert(
    creatures.length <= 20,
    `Population should be reduced from 20, got ${creatures.length}`,
  );

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
});

Deno.test("DeDuplicator preserves array order for non-removed elements", () => {
  const config = createNeatConfig({
    populationSize: 5,
    elitism: 1,
    mutationRate: 0.3,
  });

  // Create unique creatures with identifiable biases
  const creatures: Creature[] = [];
  for (let i = 0; i < 5; i++) {
    const json = JSON.parse(JSON.stringify(baseCreature));
    json.neurons[0].bias = (i + 1) * 0.1;
    creatures.push(Creature.fromJSON(json));
  }

  // Record original UUIDs in order
  const originalUUIDs = creatures.map((c) => CreatureUtil.makeUUID(c));

  // Add duplicates that will be over the population size threshold
  for (let i = 0; i < 10; i++) {
    creatures.push(Creature.fromJSON(creatures[0].exportInternalJSON()));
  }

  const genus = new Genus();
  const breed = new Breed(genus, config);
  const mutator = new Mutator(config);
  const deDuplicator = new DeDuplicator(breed, mutator);

  deDuplicator.perform(creatures);

  // The first 5 unique creatures should still be present
  const remainingUUIDs = new Set<string>();
  for (const creature of creatures) {
    remainingUUIDs.add(CreatureUtil.makeUUID(creature));
  }

  for (const uuid of originalUUIDs) {
    assert(
      remainingUUIDs.has(uuid),
      `Original creature ${uuid} should be preserved`,
    );
  }
});
