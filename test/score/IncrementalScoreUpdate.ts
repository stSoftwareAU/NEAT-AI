import { assertEquals, assertNotEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "../../src/architecture/Score.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

/**
 * Test suite for incremental score update optimisation.
 * Issue #1045: Implement incremental score update for weight-only mutations.
 *
 * When MOD_WEIGHT or MOD_BIAS mutations occur, rather than invalidating the
 * entire score cache and recalculating everything, we can incrementally update
 * only the weight/bias-related penalty components.
 */

function createSimpleCreature(): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: 2, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

function createLargeCreature(): Creature {
  // Create a creature with many neurons and synapses to test performance benefits
  const creature = new Creature(10, 2, {
    layers: [
      { count: 20, squash: IDENTITY.NAME },
      { count: 10, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });
  return creature;
}

Deno.test("IncrementalScoreUpdate: weight change should produce same score as full recalculation", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score to populate the cache
  calculate(creature, error, growthCost);

  // Get a synapse and record its old weight
  const synapse = creature.synapses[0];
  const oldWeight = synapse.weight;
  const newWeight = oldWeight + 5.0; // Significant weight change

  // Calculate what the new score should be with incremental update
  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Now actually change the weight and do full recalculation
  synapse.weight = newWeight;
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  // Incremental score should match full recalculation
  assertEquals(
    incrementalScore,
    fullRecalcScore,
    `Incremental score (${incrementalScore}) should match full recalc (${fullRecalcScore})`,
  );
});

Deno.test("IncrementalScoreUpdate: bias change should produce same score as full recalculation", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score to populate the cache
  calculate(creature, error, growthCost);

  // Get a non-input neuron and record its old bias
  const neuron = creature.neurons[creature.input];
  const oldBias = neuron.bias;
  const newBias = oldBias + 5.0; // Significant bias change

  // Calculate what the new score should be with incremental update
  const incrementalScore = updateScoreForBiasChange(
    creature,
    error,
    growthCost,
    oldBias,
    newBias,
  );

  // Now actually change the bias and do full recalculation
  neuron.bias = newBias;
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  // Incremental score should match full recalculation
  assertEquals(
    incrementalScore,
    fullRecalcScore,
    `Incremental score (${incrementalScore}) should match full recalc (${fullRecalcScore})`,
  );
});

Deno.test("IncrementalScoreUpdate: cache should be updated after incremental weight update", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score to populate cache
  calculate(creature, error, growthCost);
  const initialCache = creature.cachedScoreComponents!;

  // Get a synapse and modify it
  const synapse = creature.synapses[0];
  const oldWeight = synapse.weight;
  const newWeight = oldWeight + 10.0;

  // Use incremental update
  updateScoreForWeightChange(creature, error, growthCost, oldWeight, newWeight);

  // Update the actual weight
  synapse.weight = newWeight;

  // Cache should be updated, not invalidated
  assertNotEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be updated, not invalidated after incremental update",
  );

  // The maxWeightBias or avgWeightBias should have changed
  const newCache = creature.cachedScoreComponents!;
  const maxChanged = newCache.maxWeightBias !== initialCache.maxWeightBias;
  const avgChanged = newCache.avgWeightBias !== initialCache.avgWeightBias;

  assertEquals(
    maxChanged || avgChanged,
    true,
    "At least one of maxWeightBias or avgWeightBias should have changed",
  );
});

Deno.test("IncrementalScoreUpdate: cache should be updated after incremental bias update", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score to populate cache
  calculate(creature, error, growthCost);
  const initialCache = creature.cachedScoreComponents!;

  // Get a non-input neuron and modify its bias
  const neuron = creature.neurons[creature.input];
  const oldBias = neuron.bias;
  const newBias = oldBias + 10.0;

  // Use incremental update
  updateScoreForBiasChange(creature, error, growthCost, oldBias, newBias);

  // Update the actual bias
  neuron.bias = newBias;

  // Cache should be updated, not invalidated
  assertNotEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be updated, not invalidated after incremental update",
  );

  // The maxWeightBias or avgWeightBias should have changed
  const newCache = creature.cachedScoreComponents!;
  const maxChanged = newCache.maxWeightBias !== initialCache.maxWeightBias;
  const avgChanged = newCache.avgWeightBias !== initialCache.avgWeightBias;

  assertEquals(
    maxChanged || avgChanged,
    true,
    "At least one of maxWeightBias or avgWeightBias should have changed",
  );
});

Deno.test("IncrementalScoreUpdate: structure components should remain unchanged after weight update", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score
  calculate(creature, error, growthCost);
  const initialCache = creature.cachedScoreComponents!;
  const initialHiddenCount = initialCache.hiddenNeuronCount;
  const initialSquashPenalty = initialCache.squashComplexityPenalty;

  // Perform weight update
  const synapse = creature.synapses[0];
  const oldWeight = synapse.weight;
  const newWeight = oldWeight + 10.0;

  updateScoreForWeightChange(creature, error, growthCost, oldWeight, newWeight);
  synapse.weight = newWeight;

  // Structure-related cached values should remain the same
  const newCache = creature.cachedScoreComponents!;
  assertEquals(
    newCache.hiddenNeuronCount,
    initialHiddenCount,
    "Hidden neuron count should not change for weight-only mutation",
  );
  assertEquals(
    newCache.squashComplexityPenalty,
    initialSquashPenalty,
    "Squash complexity penalty should not change for weight-only mutation",
  );
});

Deno.test("IncrementalScoreUpdate: structure components should remain unchanged after bias update", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score
  calculate(creature, error, growthCost);
  const initialCache = creature.cachedScoreComponents!;
  const initialHiddenCount = initialCache.hiddenNeuronCount;
  const initialSquashPenalty = initialCache.squashComplexityPenalty;

  // Perform bias update
  const neuron = creature.neurons[creature.input];
  const oldBias = neuron.bias;
  const newBias = oldBias + 10.0;

  updateScoreForBiasChange(creature, error, growthCost, oldBias, newBias);
  neuron.bias = newBias;

  // Structure-related cached values should remain the same
  const newCache = creature.cachedScoreComponents!;
  assertEquals(
    newCache.hiddenNeuronCount,
    initialHiddenCount,
    "Hidden neuron count should not change for bias-only mutation",
  );
  assertEquals(
    newCache.squashComplexityPenalty,
    initialSquashPenalty,
    "Squash complexity penalty should not change for bias-only mutation",
  );
});

Deno.test("IncrementalScoreUpdate: multiple weight changes should accumulate correctly", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score
  calculate(creature, error, growthCost);

  // Make multiple weight changes incrementally
  for (let i = 0; i < Math.min(3, creature.synapses.length); i++) {
    const synapse = creature.synapses[i];
    const oldWeight = synapse.weight;
    const newWeight = oldWeight + (i + 1) * 2.0;

    updateScoreForWeightChange(
      creature,
      error,
      growthCost,
      oldWeight,
      newWeight,
    );
    synapse.weight = newWeight;
  }

  // Get the score after incremental updates
  const incrementalScore = calculate(creature, error, growthCost);

  // Verify by doing a full recalculation
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    `After multiple updates, incremental (${incrementalScore}) should match full (${fullRecalcScore})`,
  );
});

Deno.test("IncrementalScoreUpdate: should handle negative weight changes", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score
  calculate(creature, error, growthCost);

  // Get a synapse and make a negative weight change
  const synapse = creature.synapses[0];
  const oldWeight = synapse.weight;
  const newWeight = -Math.abs(oldWeight) - 5.0; // Ensure negative

  // Calculate with incremental update
  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Apply the change and do full recalculation
  synapse.weight = newWeight;
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Incremental score should match for negative weight changes",
  );
});

Deno.test("IncrementalScoreUpdate: should handle zero weight changes", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Calculate initial score to populate the cache
  calculate(creature, error, growthCost);

  // Get a synapse and change to zero
  const synapse = creature.synapses[0];
  const oldWeight = synapse.weight;
  const newWeight = 0;

  // Calculate with incremental update
  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Apply the change and do full recalculation
  synapse.weight = newWeight;
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Incremental score should match for zero weight",
  );
});

Deno.test("IncrementalScoreUpdate: performance - incremental should be faster than full recalc for large creatures", () => {
  const creature = createLargeCreature();
  const growthCost = 0.0001;
  const error = 0.1;
  const iterations = 100;

  // Calculate initial score to populate cache
  calculate(creature, error, growthCost);

  // Benchmark incremental updates
  const incrementalStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const synapse = creature.synapses[i % creature.synapses.length];
    const oldWeight = synapse.weight;
    const newWeight = oldWeight + 0.1;
    updateScoreForWeightChange(
      creature,
      error,
      growthCost,
      oldWeight,
      newWeight,
    );
    synapse.weight = newWeight;
  }
  const incrementalTime = performance.now() - incrementalStart;

  // Reset weights for full recalculation benchmark
  for (let i = 0; i < iterations; i++) {
    creature.synapses[i % creature.synapses.length].weight -= 0.1;
  }

  // Benchmark full recalculations
  const fullRecalcStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const synapse = creature.synapses[i % creature.synapses.length];
    synapse.weight += 0.1;
    creature.invalidateScoreCache();
    calculate(creature, error, growthCost);
  }
  const fullRecalcTime = performance.now() - fullRecalcStart;

  // Log results for visibility
  console.log(
    `Incremental: ${incrementalTime.toFixed(3)}ms, Full: ${
      fullRecalcTime.toFixed(3)
    }ms`,
  );

  // Incremental should be at least 20% faster (conservative threshold)
  const improvementRatio = fullRecalcTime / incrementalTime;
  assertEquals(
    improvementRatio > 1.2,
    true,
    `Incremental updates should be faster. Improvement ratio: ${
      improvementRatio.toFixed(2)
    }x`,
  );
});

Deno.test("IncrementalScoreUpdate: should work when cache is empty", () => {
  const creature = createSimpleCreature();
  const growthCost = 0.0001;
  const error = 0.1;

  // Don't calculate score first - cache is empty
  assertEquals(
    creature.cachedScoreComponents,
    undefined,
    "Cache should be empty initially",
  );

  // Get a synapse
  const synapse = creature.synapses[0];
  const oldWeight = synapse.weight;
  const newWeight = oldWeight + 5.0;

  // Incremental update should work even with empty cache
  // (it should build the cache first)
  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Apply the change and verify
  synapse.weight = newWeight;
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Incremental update should work correctly even when cache was initially empty",
  );
});
