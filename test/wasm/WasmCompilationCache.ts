/**
 * WASM Compilation Cache Tests
 *
 * Issue #1301 - Performance: WASM creature compilation caching
 * Issue #1539 - Perf: O(1) LRU eviction and buffer pooling
 *
 * These tests verify:
 * 1. Cache returns same module for creatures with identical topologies
 * 2. Cache produces different modules for creatures with different topologies
 * 3. LRU eviction works correctly when cache is full
 * 4. Cache invalidation works on structural mutations
 * 5. Cache hit/miss statistics are tracked correctly
 * 6. LRU eviction order is correct (evicts least recently used, not arbitrary)
 * 7. Repeated cache hits produce correct activation results
 * 8. Reducing cache size triggers correct eviction count
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  clearWasmCompilationCache,
  getOrCompileWasmModule,
  getWasmCompilationCacheStats,
  invalidateWasmCache,
  setWasmCompilationCacheSize,
} from "../../src/wasm/WasmCompilationCache.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";

/**
 * Create a simple test creature with the given number of hidden neurons.
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
  // Modify all weights
  for (const synapse of json.synapses) {
    synapse.weight = synapse.weight * 2 + 0.1;
  }
  // Modify all biases
  for (const neuron of json.neurons) {
    if (neuron.bias !== undefined) {
      neuron.bias = (neuron.bias ?? 0) * 2 + 0.1;
    }
  }
  return Creature.fromJSON(json);
}

Deno.test("WasmCompilationCache: same topology returns cached module", () => {
  clearWasmCompilationCache();

  // Create two creatures with identical topology but different weights
  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = cloneWithDifferentWeights(creature1);

  // Verify they have the same topology hash
  const hash1 = CreatureUtil.getTopologyHash(creature1);
  const hash2 = CreatureUtil.getTopologyHash(creature2);
  assertEquals(hash1, hash2, "Topology hashes should match for same structure");

  // Get compiled modules
  const module1 = getOrCompileWasmModule(creature1);
  const module2 = getOrCompileWasmModule(creature2);

  assertExists(module1, "First module should exist");
  assertExists(module2, "Second module should exist");

  // Check cache statistics
  const stats = getWasmCompilationCacheStats();
  assertEquals(stats.hits, 1, "Should have 1 cache hit");
  assertEquals(stats.misses, 1, "Should have 1 cache miss");
  assertEquals(stats.size, 1, "Cache should have 1 entry");

  creature1.dispose();
  creature2.dispose();
});

Deno.test("WasmCompilationCache: different topology returns different module", () => {
  clearWasmCompilationCache();

  // Create creatures with different topologies
  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 5, squash: "TANH" }]); // Different hidden count

  // Verify they have different topology hashes
  const hash1 = CreatureUtil.getTopologyHash(creature1);
  const hash2 = CreatureUtil.getTopologyHash(creature2);
  assertNotEquals(
    hash1,
    hash2,
    "Topology hashes should differ for different structures",
  );

  // Get compiled modules
  const module1 = getOrCompileWasmModule(creature1);
  const module2 = getOrCompileWasmModule(creature2);

  assertExists(module1, "First module should exist");
  assertExists(module2, "Second module should exist");

  // Check cache statistics
  const stats = getWasmCompilationCacheStats();
  assertEquals(stats.hits, 0, "Should have 0 cache hits");
  assertEquals(stats.misses, 2, "Should have 2 cache misses");
  assertEquals(stats.size, 2, "Cache should have 2 entries");

  creature1.dispose();
  creature2.dispose();
});

Deno.test("WasmCompilationCache: LRU eviction when cache is full", () => {
  clearWasmCompilationCache();

  // Set a small cache size for testing
  const originalSize = setWasmCompilationCacheSize(3);

  try {
    // Create 4 creatures with different topologies
    const creatures = [
      createTestCreature(3, 2, [{ count: 2, squash: "TANH" }]),
      createTestCreature(3, 2, [{ count: 3, squash: "TANH" }]),
      createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]),
      createTestCreature(3, 2, [{ count: 5, squash: "TANH" }]),
    ];

    // Compile all creatures
    for (const creature of creatures) {
      getOrCompileWasmModule(creature);
    }

    // Check cache - should have evicted the first entry (LRU)
    const stats = getWasmCompilationCacheStats();
    assertEquals(stats.size, 3, "Cache should have 3 entries (max size)");
    assertEquals(stats.evictions, 1, "Should have 1 eviction");

    // Accessing the first creature again should be a cache miss
    getOrCompileWasmModule(creatures[0]);
    const statsAfter = getWasmCompilationCacheStats();
    assertEquals(statsAfter.misses, 5, "Should have 5 total cache misses");

    // Clean up
    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    // Restore original cache size
    setWasmCompilationCacheSize(originalSize);
  }
});

Deno.test("WasmCompilationCache: invalidate clears specific entry", () => {
  clearWasmCompilationCache();

  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 5, squash: "TANH" }]);

  // Compile both creatures
  getOrCompileWasmModule(creature1);
  getOrCompileWasmModule(creature2);

  let stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 2, "Cache should have 2 entries");

  // Invalidate creature1's cache entry
  invalidateWasmCache(creature1);

  stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 1, "Cache should have 1 entry after invalidation");

  // Compiling creature1 again should be a cache miss
  getOrCompileWasmModule(creature1);
  stats = getWasmCompilationCacheStats();
  assertEquals(stats.misses, 3, "Should have 3 cache misses");

  creature1.dispose();
  creature2.dispose();
});

Deno.test("WasmCompilationCache: clear removes all entries", () => {
  clearWasmCompilationCache();

  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 5, squash: "TANH" }]);

  getOrCompileWasmModule(creature1);
  getOrCompileWasmModule(creature2);

  let stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 2, "Cache should have 2 entries");

  clearWasmCompilationCache();

  stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 0, "Cache should be empty after clear");
  assertEquals(stats.hits, 0, "Hits should be reset after clear");
  assertEquals(stats.misses, 0, "Misses should be reset after clear");

  creature1.dispose();
  creature2.dispose();
});

Deno.test("WasmCompilationCache: topology hash invalidated on mutation", () => {
  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);

  // Get initial topology hash
  const hash1 = CreatureUtil.getTopologyHash(creature);
  assertExists(hash1, "Initial hash should exist");
  assertEquals(
    creature.topologyHash,
    hash1,
    "Hash should be cached on creature",
  );

  // Simulate structural mutation by clearing the hash
  // (In real mutations, this happens via clearCache())
  creature.clearCache();

  // The cached topology hash should be invalidated
  assertEquals(
    creature.topologyHash,
    undefined,
    "Topology hash should be undefined after clearCache",
  );

  creature.dispose();
});

Deno.test("WasmCompilationCache: different squash functions create different cache entries", () => {
  clearWasmCompilationCache();

  // Create creatures with same structure but different squash functions
  const creature1 = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const creature2 = createTestCreature(3, 2, [{ count: 4, squash: "RELU" }]);

  const hash1 = CreatureUtil.getTopologyHash(creature1);
  const hash2 = CreatureUtil.getTopologyHash(creature2);

  // Squash function is part of topology, so hashes should differ
  assertNotEquals(
    hash1,
    hash2,
    "Different squash functions should produce different topology hashes",
  );

  getOrCompileWasmModule(creature1);
  getOrCompileWasmModule(creature2);

  const stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 2, "Cache should have 2 entries");
  assertEquals(stats.misses, 2, "Should have 2 cache misses");

  creature1.dispose();
  creature2.dispose();
});

Deno.test("WasmCompilationCache: cache statistics track correctly", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const clone = cloneWithDifferentWeights(creature);

  // First access - miss
  getOrCompileWasmModule(creature);
  let stats = getWasmCompilationCacheStats();
  assertEquals(stats.hits, 0);
  assertEquals(stats.misses, 1);

  // Second access with same topology - hit
  getOrCompileWasmModule(clone);
  stats = getWasmCompilationCacheStats();
  assertEquals(stats.hits, 1);
  assertEquals(stats.misses, 1);

  // Third access with original - hit
  getOrCompileWasmModule(creature);
  stats = getWasmCompilationCacheStats();
  assertEquals(stats.hits, 2);
  assertEquals(stats.misses, 1);

  // Hit rate should be 2/3 = 66.67%
  const hitRate = stats.hits / (stats.hits + stats.misses);
  assert(
    Math.abs(hitRate - 0.6667) < 0.01,
    `Hit rate should be ~66.67%, got ${hitRate * 100}%`,
  );

  creature.dispose();
  clone.dispose();
});

Deno.test("WasmCompilationCache: LRU evicts correct entry after access reorder", () => {
  clearWasmCompilationCache();
  const originalSize = setWasmCompilationCacheSize(3);

  try {
    // Create 4 creatures with different topologies (A, B, C, D)
    const creatures = [
      createTestCreature(3, 2, [{ count: 2, squash: "TANH" }]), // A
      createTestCreature(3, 2, [{ count: 3, squash: "TANH" }]), // B
      createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]), // C
      createTestCreature(3, 2, [{ count: 5, squash: "TANH" }]), // D
    ];

    // Insert A, B, C (fills cache to capacity)
    getOrCompileWasmModule(creatures[0]); // A (miss)
    getOrCompileWasmModule(creatures[1]); // B (miss)
    getOrCompileWasmModule(creatures[2]); // C (miss)

    // Access A again, making B the least recently used
    getOrCompileWasmModule(creatures[0]); // A (hit — moves to MRU)

    let stats = getWasmCompilationCacheStats();
    assertEquals(stats.hits, 1, "Should have 1 hit after re-accessing A");
    assertEquals(stats.size, 3, "Cache should still have 3 entries");

    // Insert D — should evict B (the LRU), not A or C
    getOrCompileWasmModule(creatures[3]); // D (miss — triggers eviction)

    stats = getWasmCompilationCacheStats();
    assertEquals(stats.evictions, 1, "Should have 1 eviction");
    assertEquals(stats.size, 3, "Cache should still have 3 entries");

    // B was evicted, so accessing it should be a miss
    const prevMisses = stats.misses;
    getOrCompileWasmModule(creatures[1]); // B (miss — was evicted)

    stats = getWasmCompilationCacheStats();
    assertEquals(
      stats.misses,
      prevMisses + 1,
      "B should be a cache miss (was evicted)",
    );

    // A should still be cached (it was accessed recently)
    const prevHits = stats.hits;
    getOrCompileWasmModule(creatures[0]); // A (hit — still cached)

    stats = getWasmCompilationCacheStats();
    assertEquals(stats.hits, prevHits + 1, "A should still be cached");

    for (const creature of creatures) {
      creature.dispose();
    }
  } finally {
    setWasmCompilationCacheSize(originalSize);
  }
});

Deno.test("WasmCompilationCache: repeated hits produce correct activation results", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const input = new Float32Array([0.5, -0.3, 0.8]);

  // First activation (cache miss)
  const module1 = getOrCompileWasmModule(creature);
  assertExists(module1, "First module should exist");
  const output1 = module1.activate(input);

  // Second activation (cache hit — uses buffer from pool or fresh copy)
  const module2 = getOrCompileWasmModule(creature);
  assertExists(module2, "Second module should exist");
  const output2 = module2.activate(input);

  // Third activation (cache hit — may reuse pooled buffer)
  const module3 = getOrCompileWasmModule(creature);
  assertExists(module3, "Third module should exist");
  const output3 = module3.activate(input);

  // All activations with same creature and input should produce identical output
  assertEquals(output1.length, output2.length, "Output lengths should match");
  assertEquals(output2.length, output3.length, "Output lengths should match");
  for (let i = 0; i < output1.length; i++) {
    assertEquals(
      output1[i],
      output2[i],
      `Output[${i}] should match between 1st and 2nd activation`,
    );
    assertEquals(
      output2[i],
      output3[i],
      `Output[${i}] should match between 2nd and 3rd activation`,
    );
  }

  module1.free();
  module2.free();
  module3.free();
  creature.dispose();
});

Deno.test("WasmCompilationCache: reducing cache size triggers correct evictions", () => {
  clearWasmCompilationCache();

  // Fill cache with 5 entries
  const creatures = [];
  for (let i = 0; i < 5; i++) {
    const c = createTestCreature(3, 2, [{ count: 2 + i, squash: "TANH" }]);
    creatures.push(c);
    getOrCompileWasmModule(c);
  }

  let stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 5, "Cache should have 5 entries");
  assertEquals(stats.evictions, 0, "No evictions yet");

  // Reduce cache size to 2 — should trigger 3 evictions
  setWasmCompilationCacheSize(2);

  stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 2, "Cache should have 2 entries after resize");
  assertEquals(stats.evictions, 3, "Should have 3 evictions from resize");

  // Restore default and clean up
  setWasmCompilationCacheSize(100);
  for (const creature of creatures) {
    creature.dispose();
  }
});

Deno.test("WasmCompilationCache: works with minimal creatures", () => {
  clearWasmCompilationCache();

  // Create minimal creature (just input -> output)
  const creature = new Creature(2, 1);
  creature.fix();

  const module = getOrCompileWasmModule(creature);
  assertExists(module, "Module should exist for minimal creature");

  const stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 1, "Cache should have 1 entry");

  creature.dispose();
});
