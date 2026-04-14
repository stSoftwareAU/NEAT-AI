/**
 * Tests for ensureWasmTemplate and hasWasmTemplate functions.
 *
 * Issue #2287 - Pre-warm WASM compilation cache before fitness evaluation.
 *
 * These tests verify:
 * 1. ensureWasmTemplate builds and caches the topology template
 * 2. ensureWasmTemplate returns true when template is already cached
 * 3. hasWasmTemplate correctly reports cache presence
 * 4. ensureWasmTemplate does not create a WasmCreatureActivation (no overhead)
 * 5. After ensureWasmTemplate, getOrCompile is a cache hit
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  clearWasmCompilationCache,
  ensureWasmTemplate,
  getOrCompileWasmModule,
  getWasmCompilationCacheStats,
  hasWasmTemplate,
} from "@wasm/WasmCompilationCache.ts";

/**
 * Create a simple test creature.
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

Deno.test("ensureWasmTemplate: caches template on first call", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);

  const wasCached = ensureWasmTemplate(creature);
  assertEquals(
    wasCached,
    false,
    "First call should report template was not cached",
  );

  const stats = getWasmCompilationCacheStats();
  assertEquals(stats.size, 1, "Cache should have 1 entry");

  creature.dispose();
});

Deno.test("ensureWasmTemplate: returns true for already-cached topology", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);

  // First call builds the template
  ensureWasmTemplate(creature);

  // Create a different creature with the same topology
  const json = creature.exportJSON();
  json.synapses.forEach((s) => (s.weight = s.weight * 3));
  json.neurons.forEach((n) => {
    if (n.bias !== undefined) n.bias = (n.bias ?? 0) * 3;
  });
  const creature2 = Creature.fromJSON(json);

  // Second call should find the template already cached
  const wasCached = ensureWasmTemplate(creature2);
  assertEquals(
    wasCached,
    true,
    "Second call should report template was cached",
  );

  creature.dispose();
  creature2.dispose();
});

Deno.test("hasWasmTemplate: returns false for uncached topology", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const hash = CreatureUtil.getTopologyHash(creature);

  assertEquals(hasWasmTemplate(hash), false);

  creature.dispose();
});

Deno.test("hasWasmTemplate: returns true after ensureWasmTemplate", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);
  const hash = CreatureUtil.getTopologyHash(creature);

  ensureWasmTemplate(creature);
  assertEquals(hasWasmTemplate(hash), true);

  creature.dispose();
});

Deno.test("ensureWasmTemplate: does not create cachedWasmActivation on creature", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);

  ensureWasmTemplate(creature);

  // The creature should NOT have a cachedWasmActivation — ensureTemplate
  // only builds the topology template without creating an activation instance.
  assertEquals(
    creature.cachedWasmActivation,
    undefined,
    "No activation should be created",
  );

  creature.dispose();
});

Deno.test("ensureWasmTemplate: subsequent getOrCompile is a cache hit", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);

  // Pre-warm the template
  ensureWasmTemplate(creature);

  const statsBefore = getWasmCompilationCacheStats();
  assertEquals(statsBefore.hits, 0, "No hits yet");
  assertEquals(
    statsBefore.misses,
    0,
    "No misses (ensureTemplate does not count)",
  );

  // Now compile via the standard path — should be a cache hit
  const activation = getOrCompileWasmModule(creature);
  assertExists(activation, "Should get a valid activation");

  const statsAfter = getWasmCompilationCacheStats();
  assertEquals(statsAfter.hits, 1, "Should be a cache hit");
  assertEquals(statsAfter.misses, 0, "No misses");

  creature.dispose();
});

Deno.test("ensureWasmTemplate: pre-computes topology hash on creature", () => {
  clearWasmCompilationCache();

  const creature = createTestCreature(3, 2, [{ count: 4, squash: "TANH" }]);

  // Topology hash should not be computed yet
  assertEquals(creature.topologyHash, undefined);

  ensureWasmTemplate(creature);

  // Topology hash should now be cached on the creature
  assertExists(creature.topologyHash, "Topology hash should be computed");
  assert(
    creature.topologyHash.length > 0,
    "Topology hash should be non-empty",
  );

  creature.dispose();
});
