import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { calculate } from "../../src/architecture/Score.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

/**
 * Test suite for caching weight/bias statistics in score calculation.
 * Issue #1011: Cache score calculation components incrementally.
 *
 * These tests verify that max/avg weight and bias values are cached
 * to avoid redundant iterations over synapses and neurons.
 */

function createSimpleCreature(): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

function createLargeCreature(): Creature {
  // Create a creature with more neurons and synapses to test caching benefits
  const creature = new Creature(10, 2, {
    layers: [
      { count: 20, squash: IDENTITY.NAME },
      { count: 10, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

Deno.test("ScoreCacheWeightBias: cached weight/bias stats should be initialised after first score calculation", () => {
  const creature = createSimpleCreature();

  // Initially, cache should be undefined
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be undefined before first score calculation",
  );

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Cache should now be populated with weight/bias statistics
  assertNotEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be populated after score calculation",
  );

  // Verify weight/bias statistics are cached
  assertEquals(
    typeof creature.cachedScoreComponents!.maxWeightBias,
    "number",
    "Max weight/bias should be cached",
  );
  assertEquals(
    typeof creature.cachedScoreComponents!.avgWeightBias,
    "number",
    "Avg weight/bias should be cached",
  );
});

Deno.test("ScoreCacheWeightBias: cached weight/bias stats should be reused on subsequent calculations", () => {
  const creature = createSimpleCreature();

  // First calculation
  const score1 = calculate(creature, 0.1, 0.0001);
  const cachedComponents1 = creature.cachedScoreComponents;
  const maxWeightBias1 = cachedComponents1!.maxWeightBias;
  const avgWeightBias1 = cachedComponents1!.avgWeightBias;

  // Second calculation with same error
  const score2 = calculate(creature, 0.1, 0.0001);
  const cachedComponents2 = creature.cachedScoreComponents;

  // Scores should be identical
  assertEquals(score1, score2, "Scores should be identical for same inputs");

  // Cache object should be the same reference (not recalculated)
  assertEquals(
    cachedComponents1,
    cachedComponents2,
    "Cache should be reused, not recreated",
  );

  // Weight/bias stats should be identical
  assertEquals(
    maxWeightBias1,
    cachedComponents2!.maxWeightBias,
    "Max weight/bias should be cached and reused",
  );
  assertEquals(
    avgWeightBias1,
    cachedComponents2!.avgWeightBias,
    "Avg weight/bias should be cached and reused",
  );
});

Deno.test("ScoreCacheWeightBias: cache should be invalidated when synapse weight changes", () => {
  const creature = createSimpleCreature();

  // Calculate initial score
  calculate(creature, 0.1, 0.0001);
  const initialCache = creature.cachedScoreComponents;
  const initialMaxWeightBias = initialCache!.maxWeightBias;

  // Modify a synapse weight directly
  const synapse = creature.synapses[0];
  const originalWeight = synapse.weight;
  synapse.weight = originalWeight + 10; // Significantly change the weight

  // Invalidate the cache (this should be called after weight changes)
  creature.invalidateScoreCache();

  // Cache should be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be invalidated after weight change",
  );

  // Recalculate score
  calculate(creature, 0.1, 0.0001);

  // Max weight/bias should be updated (the new weight is larger)
  assertNotEquals(
    creature.cachedScoreComponents!.maxWeightBias,
    initialMaxWeightBias,
    "Max weight/bias should be updated after weight change",
  );
});

Deno.test("ScoreCacheWeightBias: cache should be invalidated when neuron bias changes", () => {
  const creature = createSimpleCreature();

  // Calculate initial score
  calculate(creature, 0.1, 0.0001);
  const initialCache = creature.cachedScoreComponents;
  const initialMaxWeightBias = initialCache!.maxWeightBias;

  // Find a non-input neuron and modify its bias
  const hiddenNeuron = creature.neurons[creature.input];
  const originalBias = hiddenNeuron.bias;
  hiddenNeuron.bias = originalBias + 10; // Significantly change the bias

  // Invalidate the cache (this should be called after bias changes)
  creature.invalidateScoreCache();

  // Cache should be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be invalidated after bias change",
  );

  // Recalculate score
  calculate(creature, 0.1, 0.0001);

  // Max weight/bias should be updated (the new bias is larger)
  assertNotEquals(
    creature.cachedScoreComponents!.maxWeightBias,
    initialMaxWeightBias,
    "Max weight/bias should be updated after bias change",
  );
});

Deno.test("ScoreCacheWeightBias: cache should be invalidated when synapse is added", () => {
  const creature = createSimpleCreature();

  // Calculate initial score
  calculate(creature, 0.1, 0.0001);

  // Add a new connection with a large weight
  creature.connect(0, creature.neurons.length - 1, 100);

  // connect() should invalidate the cache
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be invalidated after adding synapse",
  );

  // Recalculate and verify max is updated
  calculate(creature, 0.1, 0.0001);

  // The max should now be at least 100 (the new weight)
  assertEquals(
    creature.cachedScoreComponents!.maxWeightBias >= 100,
    true,
    "Max weight/bias should reflect newly added large weight",
  );
});

Deno.test("ScoreCacheWeightBias: cache should be invalidated when synapse is removed", () => {
  const creature = createSimpleCreature();

  // Calculate initial score
  calculate(creature, 0.1, 0.0001);
  const initialSynapseCount = creature.synapses.length;

  // Find a synapse to remove
  const synapseToRemove = creature.synapses[0];
  const from = synapseToRemove.from;
  const to = synapseToRemove.to;

  // Use disconnect() which should invalidate the cache
  creature.disconnect(from, to);

  // Cache should be cleared by disconnect()
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be invalidated after removing synapse",
  );

  // Verify synapse was actually removed
  assertEquals(
    creature.synapses.length,
    initialSynapseCount - 1,
    "Synapse should have been removed",
  );
});

Deno.test("ScoreCacheWeightBias: cached values should be correct", () => {
  const creature = createSimpleCreature();

  // Manually calculate expected max and total
  let expectedMax = 0;
  let expectedTotal = 0;
  let expectedCount = 0;

  for (const synapse of creature.synapses) {
    const w = Math.abs(synapse.weight);
    expectedMax = Math.max(expectedMax, w);
    expectedTotal += w;
    expectedCount++;
  }

  for (const neuron of creature.neurons) {
    if (neuron.type !== "input") {
      const b = Math.abs(neuron.bias);
      expectedMax = Math.max(expectedMax, b);
      expectedTotal += b;
      expectedCount++;
    }
  }

  const expectedAvg = expectedCount > 0 ? expectedTotal / expectedCount : 0;

  // Calculate score to populate cache
  calculate(creature, 0.1, 0.0001);

  // Verify cached values match manually calculated values
  assertEquals(
    creature.cachedScoreComponents!.maxWeightBias,
    expectedMax,
    "Cached max should match manually calculated max",
  );
  assertEquals(
    creature.cachedScoreComponents!.avgWeightBias,
    expectedAvg,
    "Cached avg should match manually calculated avg",
  );
});

Deno.test("ScoreCacheWeightBias: multiple score calculations with different errors should reuse cache", () => {
  const creature = createSimpleCreature();

  // First calculation with error = 0.1
  const score1 = calculate(creature, 0.1, 0.0001);
  const cachedComponents = creature.cachedScoreComponents;

  // Second calculation with error = 0.2 (different error, same structure)
  const score2 = calculate(creature, 0.2, 0.0001);

  // Scores should be different (different errors)
  assertNotEquals(
    score1,
    score2,
    "Scores should differ for different errors",
  );

  // But cache should be the same reference (structure didn't change)
  assertEquals(
    cachedComponents,
    creature.cachedScoreComponents,
    "Cache should be reused when only error changes",
  );
});

Deno.test("ScoreCacheWeightBias: cache should persist across many calculations with varying errors", () => {
  const creature = createLargeCreature();

  // First calculation builds the cache
  calculate(creature, 0.1, 0.0001);
  const cachedComponents = creature.cachedScoreComponents;

  assertNotEquals(
    cachedComponents,
    undefined,
    "Cache should exist after first calculation",
  );

  // Subsequent calculations with different errors should reuse the same cache
  for (let i = 0; i < 99; i++) {
    calculate(creature, 0.1 + i * 0.001, 0.0001);
  }

  // The cache reference should remain the same (not recreated)
  assertEquals(
    creature.cachedScoreComponents,
    cachedComponents,
    "Cache should be reused across all calculations when structure is unchanged",
  );
});

Deno.test("ScoreCacheWeightBias: clearCache should clear weight/bias stats", () => {
  const creature = createSimpleCreature();

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Verify cache exists
  assertNotEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should exist after score calculation",
  );

  // Call clearCache()
  creature.clearCache();

  // Weight/bias stats cache should also be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Weight/bias stats cache should be cleared by clearCache()",
  );
});

Deno.test("ScoreCacheWeightBias: dispose should clear weight/bias stats", () => {
  const creature = createSimpleCreature();

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Dispose
  creature.dispose();

  // Cache should be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Weight/bias stats cache should be cleared by dispose()",
  );
});

Deno.test("ScoreCacheWeightBias: shallowClone should copy cached weight/bias stats", () => {
  const creature = createSimpleCreature();

  // Calculate score to populate cache
  calculate(creature, 0.1, 0.0001);
  const originalMaxWeightBias = creature.cachedScoreComponents!.maxWeightBias;
  const originalAvgWeightBias = creature.cachedScoreComponents!.avgWeightBias;

  // Clone the creature
  const clone = creature.shallowClone();

  // Clone should have the cached values
  assertNotEquals(
    clone.cachedScoreComponents,
    undefined,
    "Clone should have cached score components",
  );
  assertEquals(
    clone.cachedScoreComponents!.maxWeightBias,
    originalMaxWeightBias,
    "Clone should have same max weight/bias",
  );
  assertEquals(
    clone.cachedScoreComponents!.avgWeightBias,
    originalAvgWeightBias,
    "Clone should have same avg weight/bias",
  );

  // But they should be separate objects (reference inequality)
  assertEquals(
    clone.cachedScoreComponents !== creature.cachedScoreComponents,
    true,
    "Clone's cache should be a separate object reference",
  );
});
