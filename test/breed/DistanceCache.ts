/**
 * Tests for the DistanceCache module.
 *
 * Issue #1293: Verifies that pairwise genetic compatibility distances
 * are correctly cached and retrieved, and that LRU eviction works.
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import {
  clearDistanceCache,
  getCachedDistance,
  getDistanceCacheSize,
  getDistanceCacheStats,
  setCachedDistance,
  setDistanceCacheMaxSize,
} from "@breed/DistanceCache.ts";

function makeCreature(prefix: string, hiddenCount: number): Creature {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < hiddenCount; i++) {
    neurons.push({
      type: "hidden",
      uuid: `${prefix}-h-${i}`,
      squash: "TANH",
      bias: 0.1,
    });
  }
  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });

  synapses.push({
    fromUUID: "input-0",
    toUUID: `${prefix}-h-0`,
    weight: 0.5,
  });
  for (let i = 0; i < hiddenCount - 1; i++) {
    synapses.push({
      fromUUID: `${prefix}-h-${i}`,
      toUUID: `${prefix}-h-${i + 1}`,
      weight: 0.5,
    });
  }
  synapses.push({
    fromUUID: `${prefix}-h-${hiddenCount - 1}`,
    toUUID: "output-0",
    weight: 0.5,
  });

  const creature = Creature.fromJSON({
    neurons,
    synapses,
    input: 2,
    output: 1,
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

Deno.test("DistanceCache - stores and retrieves distances", () => {
  clearDistanceCache();
  setCachedDistance("uuid-a", "uuid-b", 0.75);
  assertEquals(getCachedDistance("uuid-a", "uuid-b"), 0.75);
});

Deno.test("DistanceCache - canonical key order (a,b) == (b,a)", () => {
  clearDistanceCache();
  setCachedDistance("uuid-x", "uuid-y", 0.42);
  assertEquals(getCachedDistance("uuid-y", "uuid-x"), 0.42);
});

Deno.test("DistanceCache - returns undefined on miss", () => {
  clearDistanceCache();
  assertEquals(getCachedDistance("no-such", "uuid"), undefined);
});

Deno.test("DistanceCache - clearDistanceCache removes all entries", () => {
  clearDistanceCache();
  setCachedDistance("a", "b", 0.5);
  setCachedDistance("c", "d", 0.6);
  assertEquals(getDistanceCacheSize(), 2);
  clearDistanceCache();
  assertEquals(getDistanceCacheSize(), 0);
  assertEquals(getCachedDistance("a", "b"), undefined);
});

Deno.test("DistanceCache - LRU eviction when exceeding max size", () => {
  clearDistanceCache();
  setDistanceCacheMaxSize(3);

  setCachedDistance("a", "b", 0.1);
  setCachedDistance("c", "d", 0.2);
  setCachedDistance("e", "f", 0.3);
  assertEquals(getDistanceCacheSize(), 3);

  // Access "a-b" to make it more recent
  getCachedDistance("a", "b");

  // Add a fourth entry, which should evict the oldest (c-d)
  setCachedDistance("g", "h", 0.4);
  assertEquals(getDistanceCacheSize(), 3);

  // "a-b" should still be cached (was accessed recently)
  assertNotEquals(getCachedDistance("a", "b"), undefined);
  // "g-h" should be cached (just added)
  assertNotEquals(getCachedDistance("g", "h"), undefined);

  // Reset max size to default
  setDistanceCacheMaxSize(10_000);
  clearDistanceCache();
});

Deno.test("DistanceCache - a hit refreshes recency so the unaccessed entry is evicted", () => {
  clearDistanceCache();
  setDistanceCacheMaxSize(3);

  // Insertion order (oldest first): a-b, c-d, e-f
  setCachedDistance("a", "b", 0.1);
  setCachedDistance("c", "d", 0.2);
  setCachedDistance("e", "f", 0.3);

  // Refresh the oldest entry via a hit; it should become most-recently-used.
  assertEquals(getCachedDistance("a", "b"), 0.1);

  // Inserting a fourth entry must evict the now-oldest unaccessed entry (c-d).
  setCachedDistance("g", "h", 0.4);
  assertEquals(getDistanceCacheSize(), 3);

  assertEquals(getCachedDistance("c", "d"), undefined); // evicted
  assertEquals(getCachedDistance("a", "b"), 0.1); // refreshed, retained
  assertEquals(getCachedDistance("e", "f"), 0.3); // retained
  assertEquals(getCachedDistance("g", "h"), 0.4); // newest, retained

  setDistanceCacheMaxSize(10_000);
  clearDistanceCache();
});

Deno.test("DistanceCache - eviction strictly bounds the cache at maxSize", () => {
  clearDistanceCache();
  setDistanceCacheMaxSize(5);

  // Insert far more distinct entries than the cache can hold.
  for (let i = 0; i < 100; i++) {
    setCachedDistance(`bound-a-${i}`, `bound-b-${i}`, i * 0.01);
  }

  // Size never exceeds maxSize, and exactly the last 5 inserts survive.
  assertEquals(getDistanceCacheSize(), 5);
  const stats = getDistanceCacheStats();
  assertEquals(stats.evictions, 95);

  for (let i = 0; i < 95; i++) {
    assertEquals(getCachedDistance(`bound-a-${i}`, `bound-b-${i}`), undefined);
  }
  for (let i = 95; i < 100; i++) {
    assertEquals(getCachedDistance(`bound-a-${i}`, `bound-b-${i}`), i * 0.01);
  }

  setDistanceCacheMaxSize(10_000);
  clearDistanceCache();
});

Deno.test("DistanceCache - shrinking maxSize evicts oldest entries immediately", () => {
  clearDistanceCache();
  setDistanceCacheMaxSize(10);

  for (let i = 0; i < 10; i++) {
    setCachedDistance(`shrink-a-${i}`, `shrink-b-${i}`, i);
  }
  assertEquals(getDistanceCacheSize(), 10);

  // Shrinking should drop the oldest entries down to the new bound.
  setDistanceCacheMaxSize(3);
  assertEquals(getDistanceCacheSize(), 3);

  // The three most-recently inserted entries remain.
  for (let i = 7; i < 10; i++) {
    assertEquals(getCachedDistance(`shrink-a-${i}`, `shrink-b-${i}`), i);
  }

  setDistanceCacheMaxSize(10_000);
  clearDistanceCache();
});

Deno.test("DistanceCache - max size is observable via stats", () => {
  clearDistanceCache();
  setDistanceCacheMaxSize(42);
  assertEquals(getDistanceCacheStats().maxSize, 42);

  // Values below 1 are clamped to 1.
  setDistanceCacheMaxSize(0);
  assertEquals(getDistanceCacheStats().maxSize, 1);

  // Reset to default for other tests.
  setDistanceCacheMaxSize(10_000);
  clearDistanceCache();
});

Deno.test("DistanceCache - stats track hits and misses", () => {
  clearDistanceCache();
  setCachedDistance("s1", "s2", 0.9);

  getCachedDistance("s1", "s2"); // hit
  getCachedDistance("s1", "s2"); // hit
  getCachedDistance("no", "match"); // miss

  const stats = getDistanceCacheStats();
  assertEquals(stats.hits, 2);
  assertEquals(stats.misses, 1);
  assertEquals(stats.currentSize, 1);
  clearDistanceCache();
});

Deno.test("DistanceCache - geneticCompatibility uses cache for same pair", () => {
  clearDistanceCache();

  const creatureA = makeCreature("cache-a", 10);
  const creatureB = makeCreature("cache-b", 10);

  // First call computes and caches
  const result1 = geneticCompatibility(creatureA, creatureB);

  // Verify distance was cached
  const uuidA = creatureA.uuid!;
  const uuidB = creatureB.uuid!;
  const cached = getCachedDistance(uuidA, uuidB);
  assertEquals(cached, result1);

  // Second call should return same result (from cache)
  const result2 = geneticCompatibility(creatureA, creatureB);
  assertEquals(result1, result2);

  clearDistanceCache();
});

Deno.test("DistanceCache - geneticCompatibility returns same result with and without cache", () => {
  clearDistanceCache();

  const creatureA = makeCreature("verify-a", 15);
  const creatureB = makeCreature("verify-b", 15);

  // First call: cache miss, computes fresh
  const freshResult = geneticCompatibility(creatureA, creatureB);

  // Second call: cache hit
  const cachedResult = geneticCompatibility(creatureA, creatureB);

  // Both should be identical
  assertEquals(freshResult, cachedResult);

  // Clear cache and recompute - should still match
  clearDistanceCache();
  const recomputedResult = geneticCompatibility(creatureA, creatureB);
  assertEquals(freshResult, recomputedResult);

  clearDistanceCache();
});

Deno.test("DistanceCache - creatures without UUIDs bypass cache", () => {
  clearDistanceCache();

  // Create creatures without generating UUIDs
  const json: CreatureExport = {
    neurons: [
      { type: "hidden", uuid: "no-uuid-h-0", bias: 0.1, squash: "TANH" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "no-uuid-h-0", weight: 0.5 },
      { fromUUID: "no-uuid-h-0", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  };

  const creatureA = Creature.fromJSON(json);
  creatureA.validate();
  // Deliberately do NOT call makeUUID

  const creatureB = Creature.fromJSON(json);
  creatureB.validate();

  // Should still compute correctly, just not cache
  const result = geneticCompatibility(creatureA, creatureB);
  assertEquals(result, 1); // Same hidden neuron UUIDs
  assertEquals(getDistanceCacheSize(), 0); // Nothing cached

  clearDistanceCache();
});

Deno.test("DistanceCache - shared neurons produce correct cached compatibility", () => {
  clearDistanceCache();

  // Creature with shared + unique neurons
  const sharedCreature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "shared-0", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "shared-1", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-a-0", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-a-1", bias: 0.1, squash: "TANH" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared-0", weight: 0.5 },
      { fromUUID: "shared-0", toUUID: "shared-1", weight: 0.5 },
      { fromUUID: "shared-1", toUUID: "unique-a-0", weight: 0.5 },
      { fromUUID: "unique-a-0", toUUID: "unique-a-1", weight: 0.5 },
      { fromUUID: "unique-a-1", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });
  sharedCreature.validate();
  CreatureUtil.makeUUID(sharedCreature);

  const otherCreature = Creature.fromJSON({
    neurons: [
      { type: "hidden", uuid: "shared-0", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "shared-1", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-b-0", bias: 0.1, squash: "TANH" },
      { type: "hidden", uuid: "unique-b-1", bias: 0.1, squash: "TANH" },
      { type: "output", uuid: "output-0", bias: 0, squash: "IDENTITY" },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared-0", weight: 0.5 },
      { fromUUID: "shared-0", toUUID: "shared-1", weight: 0.5 },
      { fromUUID: "shared-1", toUUID: "unique-b-0", weight: 0.5 },
      { fromUUID: "unique-b-0", toUUID: "unique-b-1", weight: 0.5 },
      { fromUUID: "unique-b-1", toUUID: "output-0", weight: 0.5 },
    ],
    input: 2,
    output: 1,
  });
  otherCreature.validate();
  CreatureUtil.makeUUID(otherCreature);

  // 2 shared out of 4 = 0.5
  const result = geneticCompatibility(sharedCreature, otherCreature);
  assertEquals(result, 0.5);

  // Verify cache was populated
  assertEquals(getDistanceCacheSize(), 1);

  // Repeated call should return same value
  const cachedResult = geneticCompatibility(sharedCreature, otherCreature);
  assertEquals(cachedResult, 0.5);

  clearDistanceCache();
});
