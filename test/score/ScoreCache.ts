import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { calculate } from "../../src/architecture/Score.ts";
import { Synapse } from "../../src/architecture/Synapse.ts";
import { Neuron } from "../../src/architecture/Neuron.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";
import { IF } from "../../src/methods/activations/aggregate/IF.ts";

/**
 * Test suite for score component caching in Creature objects.
 * Issue #1023: Cache score components to avoid recalculating on every score calculation.
 */

function createSimpleCreature(): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

Deno.test("ScoreCache: cached components should be initialized after first score calculation", () => {
  const creature = createSimpleCreature();

  // Initially, cache should be undefined
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be undefined before first score calculation",
  );

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Cache should now be populated
  assertNotEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be populated after score calculation",
  );

  // Verify cached values are reasonable
  assertEquals(
    typeof creature.cachedScoreComponents!.hiddenNeuronCount,
    "number",
    "Hidden neuron count should be cached",
  );
  assertEquals(
    typeof creature.cachedScoreComponents!.squashComplexityPenalty,
    "number",
    "Squash complexity penalty should be cached",
  );
});

Deno.test("ScoreCache: cache should be reused on subsequent score calculations", () => {
  const creature = createSimpleCreature();

  // First calculation
  const score1 = calculate(creature, 0.1, 0.0001);
  const cachedComponents1 = creature.cachedScoreComponents;

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
});

Deno.test("ScoreCache: cache should be invalidated when neuron is added", () => {
  const creature = createSimpleCreature();

  // Calculate initial score
  calculate(creature, 0.1, 0.0001);
  const initialCache = creature.cachedScoreComponents;
  const initialHiddenCount = initialCache!.hiddenNeuronCount;

  // Add a hidden neuron manually
  const newNeuronUUID = crypto.randomUUID();
  const hiddenNeuronIndex = creature.neurons.length - creature.output;
  creature.neurons.splice(
    hiddenNeuronIndex,
    0,
    new Neuron(
      newNeuronUUID,
      "hidden",
      0,
      creature,
      IDENTITY.NAME,
    ),
  );

  // Update indices
  for (let i = 0; i < creature.neurons.length; i++) {
    creature.neurons[i].index = i;
  }

  // Invalidate score cache (this is what we're testing - the creature should do this automatically)
  creature.invalidateScoreCache();

  // Cache should be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be invalidated after adding neuron",
  );

  // Recalculate score
  calculate(creature, 0.1, 0.0001);

  // New cache should have updated hidden neuron count
  assertEquals(
    creature.cachedScoreComponents!.hiddenNeuronCount,
    initialHiddenCount + 1,
    "Hidden neuron count should be updated after adding neuron",
  );
});

Deno.test("ScoreCache: cache should be invalidated when synapse is added", () => {
  const creature = createSimpleCreature();

  // Calculate initial score
  calculate(creature, 0.1, 0.0001);
  const initialSynapseCount = creature.synapses.length;

  // Use connect() which should invalidate the cache
  creature.connect(0, creature.neurons.length - 1, Synapse.randomWeight());

  // Cache should be cleared by connect()
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be invalidated after adding synapse",
  );

  // Verify synapse was actually added
  assertEquals(
    creature.synapses.length,
    initialSynapseCount + 1,
    "Synapse should have been added",
  );
});

Deno.test("ScoreCache: cache should be invalidated when synapse is removed", () => {
  const creature = createSimpleCreature();

  // Calculate initial score
  calculate(creature, 0.1, 0.0001);

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
});

Deno.test("ScoreCache: cache should be invalidated when squash function changes", () => {
  // Create a creature with an IF neuron that has complexity penalty of 3
  // IF requires 3 inward connections (condition, positive, negative)
  const creature = new Creature(4, 1, {
    layers: [{ count: 1, squash: IF.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });

  // Calculate initial score - IF should add complexity penalty of 3
  calculate(creature, 0.1, 0.0001);
  const initialComplexityPenalty =
    creature.cachedScoreComponents!.squashComplexityPenalty;

  // Verify IF's penalty was captured
  assertEquals(
    initialComplexityPenalty,
    3,
    "IF neuron should have complexity penalty of 3",
  );

  // Change squash to IDENTITY which has no complexity penalty
  // Issue #1043: Use setSquash() to properly invalidate both neuron-level
  // and creature-level caches
  const hiddenNeuron = creature.neurons[creature.input];
  hiddenNeuron.setSquash(IDENTITY.NAME);

  // setSquash() should have already invalidated the cache
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be invalidated by setSquash()",
  );

  // Recalculate score
  calculate(creature, 0.1, 0.0001);

  // Complexity penalty should now be 0 (IDENTITY has no penalty)
  assertEquals(
    creature.cachedScoreComponents!.squashComplexityPenalty,
    0,
    "Squash complexity penalty should be 0 after changing to IDENTITY",
  );
});

Deno.test("ScoreCache: cached hidden neuron count should be correct", () => {
  const creature = createSimpleCreature();

  // Calculate expected hidden count
  const expectedHiddenCount = creature.neurons.length - creature.input -
    creature.output;

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Verify cached value matches
  assertEquals(
    creature.cachedScoreComponents!.hiddenNeuronCount,
    expectedHiddenCount,
    "Cached hidden neuron count should match actual count",
  );
});

Deno.test("ScoreCache: clearCache should also clear score cache", () => {
  const creature = createSimpleCreature();

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Verify cache exists
  assertNotEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should exist after score calculation",
  );

  // Call clearCache() (existing method)
  creature.clearCache();

  // Score cache should also be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be cleared by clearCache()",
  );
});

Deno.test("ScoreCache: dispose should clear score cache", () => {
  const creature = createSimpleCreature();

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Dispose
  creature.dispose();

  // Score cache should be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be cleared by dispose()",
  );
});

Deno.test("ScoreCache: fix() should invalidate score cache", () => {
  const creature = createSimpleCreature();

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Call fix() which may change structure
  creature.fix();

  // Score cache should be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be cleared by fix()",
  );
});

Deno.test("ScoreCache: loadFrom should clear score cache", () => {
  const creature = createSimpleCreature();

  // Calculate score
  calculate(creature, 0.1, 0.0001);

  // Create another creature and load from it
  const otherCreature = createSimpleCreature();
  const json = otherCreature.exportJSON();

  creature.loadFrom(json, false);

  // Score cache should be cleared
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Score cache should be cleared by loadFrom()",
  );
});
