/**
 * WASM Cache Pre-Warmer Tests
 *
 * Issue #2287 - Pre-warm WASM compilation cache before fitness evaluation.
 *
 * These tests verify:
 * 1. Pre-warming computes topology hashes for all unevaluated creatures
 * 2. Pre-warming compiles WASM templates for unique topologies
 * 3. Already-cached topologies are not recompiled
 * 4. Creatures with scores are skipped (already evaluated)
 * 5. Result statistics are accurately reported
 * 6. Pre-warming does not adversely impact the LRU cache
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  clearWasmCompilationCache,
  getWasmCompilationCacheStats,
  setWasmCompilationCacheSize,
} from "@wasm/WasmCompilationCache.ts";
import { preWarmWasmCache } from "@wasm/WasmCachePreWarmer.ts";

/**
 * Create a simple test creature with the given topology.
 */
function createTestCreature(
  inputs: number,
  outputs: number,
  hiddenLayers: { count: number; squash?: string }[] = [],
): Creature {
  const creature = new Creature(inputs, outputs, {
    layers: hiddenLayers,
  });
  creature.fix();
  return creature;
}

/**
 * Create a clone of a creature with the same topology but different weights.
 */
function cloneWithDifferentWeights(creature: Creature): Creature {
  const json = creature.exportJSON();
  for (const synapse of json.synapses) {
    synapse.weight = synapse.weight * 2 + 0.1;
  }
  for (const neuron of json.neurons) {
    if (neuron.bias !== undefined) {
      neuron.bias = (neuron.bias ?? 0) * 2 + 0.1;
    }
  }
  return Creature.fromJSON(json);
}

Deno.test("WasmCachePreWarmer: pre-computes topology hashes", () => {
  clearWasmCompilationCache();

  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 6, squash: "RELU" }]);
  const creature3 = createTestCreature(4, 1, [{
    count: 3,
    squash: "LOGISTIC",
  }]);

  // Ensure no hashes are pre-computed
  assertEquals(creature1.topologyHash, undefined);
  assertEquals(creature2.topologyHash, undefined);
  assertEquals(creature3.topologyHash, undefined);

  const result = preWarmWasmCache([creature1, creature2, creature3]);

  // All creatures should now have topology hashes computed
  assertExists(creature1.topologyHash, "creature1 should have topology hash");
  assertExists(creature2.topologyHash, "creature2 should have topology hash");
  assertExists(creature3.topologyHash, "creature3 should have topology hash");

  assertEquals(result.totalCreatures, 3);
  assertEquals(result.unevaluatedCreatures, 3);
  assertEquals(result.uniqueTopologies, 3);
  assert(result.elapsedMs >= 0, "Elapsed time should be non-negative");

  creature1.dispose();
  creature2.dispose();
  creature3.dispose();
});

Deno.test("WasmCachePreWarmer: pre-compiles WASM templates for unique topologies", () => {
  clearWasmCompilationCache();

  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = cloneWithDifferentWeights(creature1); // Same topology
  const creature3 = createTestCreature(3, 2, [{ count: 6, squash: "RELU" }]);

  const result = preWarmWasmCache([creature1, creature2, creature3]);

  // Should have found 2 unique topologies (creature1 and creature2 share one)
  assertEquals(result.uniqueTopologies, 2);
  assertEquals(result.newTemplatesCompiled, 2);
  assertEquals(result.cachedTemplates, 0);

  // Verify cache stats reflect the pre-warming
  const stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 2, "Cache should have 2 entries");

  creature1.dispose();
  creature2.dispose();
  creature3.dispose();
});

Deno.test("WasmCachePreWarmer: skips already-cached topologies", () => {
  clearWasmCompilationCache();

  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 6, squash: "RELU" }]);

  // First pass: pre-warm both topologies
  preWarmWasmCache([creature1, creature2]);

  const statsAfterFirst = getWasmCompilationCacheStats();
  assertEquals(statsAfterFirst.size, 2);

  // Create new creatures with the same topologies
  const creature3 = cloneWithDifferentWeights(creature1);
  const creature4 = cloneWithDifferentWeights(creature2);

  // Second pass: should find all topologies already cached
  const result = preWarmWasmCache([creature3, creature4]);

  assertEquals(result.uniqueTopologies, 2);
  assertEquals(result.newTemplatesCompiled, 0);
  assertEquals(result.cachedTemplates, 2);

  creature1.dispose();
  creature2.dispose();
  creature3.dispose();
  creature4.dispose();
});

Deno.test("WasmCachePreWarmer: skips creatures with existing scores", () => {
  clearWasmCompilationCache();

  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 6, squash: "RELU" }]);

  // Simulate creature1 already being evaluated (has a score)
  creature1.score = -0.5;

  const result = preWarmWasmCache([creature1, creature2]);

  // Only creature2 should have been processed (creature1 has a score)
  assertEquals(result.totalCreatures, 2);
  assertEquals(result.unevaluatedCreatures, 1);
  assertEquals(result.uniqueTopologies, 1);
  assertEquals(result.newTemplatesCompiled, 1);

  creature1.dispose();
  creature2.dispose();
});

Deno.test("WasmCachePreWarmer: handles empty population", () => {
  clearWasmCompilationCache();

  const result = preWarmWasmCache([]);

  assertEquals(result.totalCreatures, 0);
  assertEquals(result.unevaluatedCreatures, 0);
  assertEquals(result.uniqueTopologies, 0);
  assertEquals(result.newTemplatesCompiled, 0);
  assertEquals(result.cachedTemplates, 0);
  assertEquals(result.ineligibleCreatures, 0);
  assert(result.elapsedMs >= 0);
});

Deno.test("WasmCachePreWarmer: handles population where all have scores", () => {
  clearWasmCompilationCache();

  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 6, squash: "RELU" }]);

  creature1.score = -0.5;
  creature2.score = -0.3;

  const result = preWarmWasmCache([creature1, creature2]);

  assertEquals(result.unevaluatedCreatures, 0);
  assertEquals(result.uniqueTopologies, 0);
  assertEquals(result.newTemplatesCompiled, 0);

  creature1.dispose();
  creature2.dispose();
});

Deno.test("WasmCachePreWarmer: does not cause excessive cache eviction", () => {
  // Set a small cache size to test eviction behaviour
  const previousSize = setWasmCompilationCacheSize(5);
  clearWasmCompilationCache();

  try {
    // Create 8 unique topologies (more than cache size of 5)
    const creatures: Creature[] = [];
    for (let i = 1; i <= 8; i++) {
      creatures.push(
        createTestCreature(3, 2, [{ count: i + 2, squash: "TANH" }]),
      );
    }

    const result = preWarmWasmCache(creatures);

    // All 8 unique topologies should be discovered
    assertEquals(result.uniqueTopologies, 8);
    // All 8 should be compiled (none previously cached)
    assertEquals(result.newTemplatesCompiled, 8);

    // Cache should only contain maxSize entries
    const stats = getWasmCompilationCacheStats();
    assertEquals(stats.size, 5, "Cache should be at max size");
    // Evictions should have occurred
    assertEquals(
      stats.evictions,
      3,
      "3 evictions should have occurred (8 - 5 = 3)",
    );

    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    setWasmCompilationCacheSize(previousSize);
  }
});

Deno.test("WasmCachePreWarmer: topology hashes are reusable after pre-warming", () => {
  clearWasmCompilationCache();

  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 6, squash: "RELU" }]);

  // Pre-warm
  preWarmWasmCache([creature1, creature2]);

  // Topology hashes should be cached on the creatures
  const hash1 = creature1.topologyHash;
  const hash2 = creature2.topologyHash;
  assertExists(hash1);
  assertExists(hash2);

  // Calling getTopologyHash should return the cached value (no recomputation)
  assertEquals(CreatureUtil.getTopologyHash(creature1), hash1);
  assertEquals(CreatureUtil.getTopologyHash(creature2), hash2);

  creature1.dispose();
  creature2.dispose();
});

Deno.test("WasmCachePreWarmer: multiple creatures with same topology only compile once", () => {
  clearWasmCompilationCache();

  const base = createTestCreature(3, 2, [{ count: 5, squash: "TANH" }]);
  // Create 10 clones with same topology
  const population: Creature[] = [base];
  for (let i = 0; i < 9; i++) {
    population.push(cloneWithDifferentWeights(base));
  }

  const result = preWarmWasmCache(population);

  assertEquals(result.totalCreatures, 10);
  assertEquals(result.unevaluatedCreatures, 10);
  assertEquals(result.uniqueTopologies, 1, "All creatures share one topology");
  assertEquals(result.newTemplatesCompiled, 1, "Only one template compiled");

  const stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 1);

  for (const creature of population) {
    creature.dispose();
  }
});
