/**
 * Unit tests for DeDuplicator focused on the data-structure contract.
 *
 * Issue #2400: DeDuplicator is a shared architecture utility used on the
 * breeding/compaction hot path. These tests exercise the public `perform()`
 * contract directly: happy-path deduplication, idempotence, empty-input
 * behaviour, and a large-input stress run. They assert on the resulting
 * array state only — not on timing — per AGENTS.md "what" vs "how" guidance.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { Creature } from "@creature";
import { Breed } from "@breed/Breed.ts";
import { Genus } from "@neat/Genus.ts";
import { Mutator } from "@neat/Mutator.ts";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import { DeDuplicator } from "@architecture/DeDuplicator.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

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
 * Helper: build a fresh DeDuplicator with a config appropriate for the test.
 */
function makeDeDuplicator(
  populationSize: number,
  elitism: number = 1,
): DeDuplicator {
  const config = createNeatConfig({
    populationSize,
    elitism,
    mutationRate: 0.3,
  });
  const genus = new Genus();
  const breed = new Breed(genus, config);
  const mutator = new Mutator(config);
  return new DeDuplicator(breed, mutator);
}

/**
 * Helper: assert every UUID in the population is unique.
 */
function assertAllUnique(creatures: Creature[]): void {
  const seen = new Set<string>();
  for (const creature of creatures) {
    const uuid = CreatureUtil.makeUUID(creature);
    assertFalse(seen.has(uuid), `Duplicate UUID after dedup: ${uuid}`);
    seen.add(uuid);
  }
}

/**
 * Helper: create a unique creature by varying the neuron biases.
 */
function makeUnique(seed: number): Creature {
  const json = JSON.parse(JSON.stringify(baseCreature));
  json.neurons[0].bias = seed * 0.013 + 0.001;
  json.neurons[1].bias = seed * 0.007 + 0.002;
  return Creature.fromJSON(json);
}

Deno.test("DeDuplicator - happy path: removes obvious duplicates", async () => {
  const creatures: Creature[] = [];
  // Five unique creatures plus ten copies of the first one.
  for (let i = 0; i < 5; i++) {
    creatures.push(makeUnique(i));
  }
  for (let i = 0; i < 10; i++) {
    creatures.push(Creature.fromJSON(creatures[0].exportJSON()));
  }

  assertEquals(creatures.length, 15);

  const dedup = makeDeDuplicator(5, 1);
  await dedup.perform(creatures);

  assertAllUnique(creatures);
  // At least the five originally unique creatures should survive.
  assert(
    creatures.length >= 5,
    `Expected >= 5 creatures after dedup, got ${creatures.length}`,
  );
});

Deno.test("DeDuplicator - idempotent: second pass is a no-op", async () => {
  const creatures: Creature[] = [];
  for (let i = 0; i < 6; i++) {
    creatures.push(makeUnique(i));
  }
  for (let i = 0; i < 6; i++) {
    creatures.push(Creature.fromJSON(creatures[i].exportJSON()));
  }

  const dedup = makeDeDuplicator(6, 1);
  await dedup.perform(creatures);

  // Snapshot state after first pass.
  const firstPassUuids = creatures.map((c) => CreatureUtil.makeUUID(c));
  const firstPassLength = creatures.length;
  assertAllUnique(creatures);

  // Run dedup again — should produce the same array.
  await dedup.perform(creatures);

  assertEquals(
    creatures.length,
    firstPassLength,
    "Second dedup pass must not change population size",
  );
  const secondPassUuids = creatures.map((c) => CreatureUtil.makeUUID(c));
  assertEquals(
    secondPassUuids,
    firstPassUuids,
    "Second dedup pass must not reorder or mutate already-unique creatures",
  );
});

Deno.test("DeDuplicator - empty input: perform returns without error", async () => {
  const creatures: Creature[] = [];
  const dedup = makeDeDuplicator(10, 1);

  await dedup.perform(creatures);

  assertEquals(creatures.length, 0, "Empty input must remain empty");
});

Deno.test(
  "DeDuplicator - single-element input: no duplicates possible",
  async () => {
    const creatures: Creature[] = [makeUnique(42)];
    const originalUuid = CreatureUtil.makeUUID(creatures[0]);

    const dedup = makeDeDuplicator(5, 1);
    await dedup.perform(creatures);

    assertEquals(creatures.length, 1, "Single creature must survive dedup");
    assertEquals(
      CreatureUtil.makeUUID(creatures[0]),
      originalUuid,
      "Single creature UUID must be preserved",
    );
  },
);

Deno.test(
  "DeDuplicator - all-unique input: nothing is removed or reordered",
  async () => {
    const creatures: Creature[] = [];
    for (let i = 0; i < 20; i++) {
      creatures.push(makeUnique(i));
    }
    const originalUuids = creatures.map((c) => CreatureUtil.makeUUID(c));

    const dedup = makeDeDuplicator(20, 1);
    await dedup.perform(creatures);

    assertEquals(
      creatures.length,
      20,
      "All-unique input must preserve every creature",
    );
    const resultUuids = creatures.map((c) => CreatureUtil.makeUUID(c));
    assertEquals(
      resultUuids,
      originalUuids,
      "All-unique input order must be preserved",
    );
  },
);

Deno.test(
  "DeDuplicator - large input: 300 creatures with 80% duplicates",
  async () => {
    // Stress test sized to stay comfortably under 120 s.
    const uniqueCount = 60;
    const duplicateCopies = 240; // 300 total, 80% duplicates.

    const creatures: Creature[] = [];
    for (let i = 0; i < uniqueCount; i++) {
      creatures.push(makeUnique(i));
    }
    // Stamp every unique UUID so cross-source duplicates are detectable.
    for (const c of creatures) {
      CreatureUtil.makeUUID(c);
    }
    for (let i = 0; i < duplicateCopies; i++) {
      const sourceIndex = i % uniqueCount;
      creatures.push(Creature.fromJSON(creatures[sourceIndex].exportJSON()));
    }

    assertEquals(creatures.length, uniqueCount + duplicateCopies);

    const dedup = makeDeDuplicator(uniqueCount, 2);
    await dedup.perform(creatures);

    assertAllUnique(creatures);
    // The unique seed creatures must still be represented in the survivors.
    assert(
      creatures.length >= uniqueCount,
      `Expected >= ${uniqueCount} survivors, got ${creatures.length}`,
    );
  },
);

Deno.test(
  "DeDuplicator - assigns UUIDs to creatures that lack them",
  async () => {
    // Creatures freshly loaded from JSON do not yet have a cached UUID; the
    // first pass of perform() must assign one via CreatureUtil.makeUUID.
    const creatures: Creature[] = [];
    for (let i = 0; i < 4; i++) {
      creatures.push(makeUnique(i));
    }

    const dedup = makeDeDuplicator(4, 1);
    await dedup.perform(creatures);

    for (const creature of creatures) {
      assert(
        typeof creature.uuid === "string" && creature.uuid.length > 0,
        "perform() must assign a UUID to every creature",
      );
    }
  },
);
