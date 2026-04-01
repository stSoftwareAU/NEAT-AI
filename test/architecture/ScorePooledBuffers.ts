/**
 * Tests for pooled Float64Array buffers in Score.ts extraction functions.
 *
 * Issue #2126: Verifies that the module-level pooled buffers grow as needed,
 * are reused across calls, and produce correct extraction results.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import {
  calculate,
  getPoolCapacities,
  resetPoolBuffers,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "@architecture/Score.ts";

/**
 * Helper to create a creature with specified hidden neuron count.
 */
function makeCreature(hiddenCount: number): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: hiddenCount, squash: "IDENTITY" }],
  });
  // Set distinct weights so extraction correctness is verifiable
  for (let i = 0; i < creature.synapses.length; i++) {
    creature.synapses[i].weight = (i + 1) * 0.1;
  }
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = (i + 1) * 0.05;
  }
  delete creature.cachedScoreComponents;
  return creature;
}

// --- Pool growth tests ---

Deno.test("pooled buffers - grow when creature size increases", () => {
  resetPoolBuffers();

  // Start with a small creature
  const small = makeCreature(2);
  calculate(small, 0.1, 0.001);

  const afterSmall = getPoolCapacities();
  assert(
    afterSmall.weightCapacity >= small.synapses.length,
    "Weight pool should accommodate small creature synapses",
  );
  assert(
    afterSmall.biasCapacity >= small.neurons.length - small.input,
    "Bias pool should accommodate small creature biases",
  );

  // Now use a larger creature — pools should grow
  const large = makeCreature(10);
  delete large.cachedScoreComponents;
  calculate(large, 0.1, 0.001);

  const afterLarge = getPoolCapacities();
  assert(
    afterLarge.weightCapacity >= large.synapses.length,
    "Weight pool should grow for larger creature",
  );
  assert(
    afterLarge.biasCapacity >= large.neurons.length - large.input,
    "Bias pool should grow for larger creature",
  );
  assert(
    afterLarge.weightCapacity >= afterSmall.weightCapacity,
    "Weight pool should grow for larger creature",
  );
  assert(
    afterLarge.biasCapacity >= afterSmall.biasCapacity,
    "Bias pool should grow for larger creature",
  );
});

Deno.test("pooled buffers - retain capacity for moderately smaller creatures", () => {
  resetPoolBuffers();

  // Use a large creature first
  const large = makeCreature(10);
  calculate(large, 0.1, 0.001);
  const afterLarge = getPoolCapacities();

  // Use a moderately smaller creature — pools should retain capacity
  // (only downsize when pool exceeds 4x the required size)
  const medium = makeCreature(5);
  delete medium.cachedScoreComponents;
  calculate(medium, 0.1, 0.001);
  const afterMedium = getPoolCapacities();

  assertEquals(
    afterMedium.weightCapacity,
    afterLarge.weightCapacity,
    "Weight pool should retain capacity for moderately smaller creature",
  );
  assertEquals(
    afterMedium.biasCapacity,
    afterLarge.biasCapacity,
    "Bias pool should retain capacity for moderately smaller creature",
  );
});

Deno.test("pooled buffers - downsize when significantly oversized", () => {
  resetPoolBuffers();

  // Use a very large creature first to grow the pools
  const large = makeCreature(20);
  calculate(large, 0.1, 0.001);
  const afterLarge = getPoolCapacities();
  assert(afterLarge.weightCapacity > 0, "Weight pool should have capacity");

  // Use a much smaller creature — pools should downsize (>4x ratio)
  const tiny = makeCreature(2);
  delete tiny.cachedScoreComponents;
  calculate(tiny, 0.1, 0.001);
  const afterTiny = getPoolCapacities();

  assert(
    afterTiny.weightCapacity < afterLarge.weightCapacity,
    "Weight pool should downsize when significantly oversized",
  );
  assert(
    afterTiny.weightCapacity >= tiny.synapses.length,
    "Downsized weight pool should still accommodate current creature",
  );
});

Deno.test("pooled buffers - reused across multiple calculate calls", () => {
  resetPoolBuffers();

  const creature = makeCreature(5);

  // First call allocates
  calculate(creature, 0.1, 0.001);
  const firstCapacity = getPoolCapacities();

  // Subsequent calls with same-sized creature should not change capacity
  for (let i = 0; i < 5; i++) {
    delete creature.cachedScoreComponents;
    calculate(creature, 0.1 + i * 0.01, 0.001);
  }

  const laterCapacity = getPoolCapacities();
  assertEquals(
    laterCapacity.weightCapacity,
    firstCapacity.weightCapacity,
    "Weight pool capacity should stay stable across repeated calls",
  );
  assertEquals(
    laterCapacity.biasCapacity,
    firstCapacity.biasCapacity,
    "Bias pool capacity should stay stable across repeated calls",
  );
});

// --- Extraction correctness tests ---

Deno.test("pooled buffers - extraction correctness verified via score consistency", () => {
  resetPoolBuffers();

  const creature = makeCreature(5);

  // Calculate with pooled buffers
  const pooledScore = calculate(creature, 0.1, 0.001);

  // Clear cache and recalculate — should produce identical result
  // (verifies that pooled extraction produces correct values)
  delete creature.cachedScoreComponents;
  const secondScore = calculate(creature, 0.1, 0.001);

  assertEquals(
    pooledScore,
    secondScore,
    "Pooled extraction should produce consistent scores",
  );
});

Deno.test("pooled buffers - correct results after pool growth", () => {
  resetPoolBuffers();

  // Use small creature to initialise pool
  const small = makeCreature(2);
  const smallScore = calculate(small, 0.1, 0.001);

  // Use large creature — forces pool growth
  const large = makeCreature(10);
  const largeScore = calculate(large, 0.1, 0.001);

  // Go back to small creature — uses subarray of larger pool
  const small2 = makeCreature(2);
  const small2Score = calculate(small2, 0.1, 0.001);

  assertEquals(
    smallScore,
    small2Score,
    "Small creature score should be identical before and after pool growth",
  );

  // Large creature should have a different score (different topology)
  assert(
    largeScore !== smallScore,
    "Different sized creatures should produce different scores",
  );
});

Deno.test("pooled buffers - incremental weight update still correct after pooling", () => {
  resetPoolBuffers();

  const creature = makeCreature(5);
  calculate(creature, 0.1, 0.001);

  const oldWeight = creature.synapses[0].weight;
  const newWeight = 2.5;
  creature.synapses[0].weight = newWeight;

  const incrementalScore = updateScoreForWeightChange(
    creature,
    0.1,
    0.001,
    oldWeight,
    newWeight,
  );

  // Verify against full recalculation
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, 0.1, 0.001);

  assertEquals(
    incrementalScore,
    fullScore,
    "Incremental weight update should match full recalculation with pooled buffers",
  );
});

Deno.test("pooled buffers - incremental bias update still correct after pooling", () => {
  resetPoolBuffers();

  const creature = makeCreature(5);
  calculate(creature, 0.1, 0.001);

  const neuronIdx = creature.input;
  const oldBias = creature.neurons[neuronIdx].bias;
  const newBias = 1.5;
  creature.neurons[neuronIdx].bias = newBias;

  const incrementalScore = updateScoreForBiasChange(
    creature,
    0.1,
    0.001,
    oldBias,
    newBias,
  );

  // Verify against full recalculation
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, 0.1, 0.001);

  assertEquals(
    incrementalScore,
    fullScore,
    "Incremental bias update should match full recalculation with pooled buffers",
  );
});

Deno.test("pooled buffers - reset clears capacity", () => {
  // Ensure pools have some capacity
  const creature = makeCreature(5);
  calculate(creature, 0.1, 0.001);

  const before = getPoolCapacities();
  assert(
    before.weightCapacity > 0,
    "Weight pool should have capacity before reset",
  );

  resetPoolBuffers();

  const after = getPoolCapacities();
  assertEquals(
    after.weightCapacity,
    0,
    "Weight pool should be empty after reset",
  );
  assertEquals(after.biasCapacity, 0, "Bias pool should be empty after reset");
});
