/**
 * Tests for max weight/bias recalculation optimisation.
 * Issue #1442: Optimise max weight/bias recalculation in Score.ts.
 *
 * These tests verify that the top-K tracking for max weight/bias values
 * produces correct results across various scenarios, particularly when
 * the current max is reduced and the new max must be found efficiently.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "../../src/architecture/Score.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

function createCreature(
  options: {
    hiddenCount?: number;
    weights?: number[];
    biases?: number[];
  } = {},
): Creature {
  const hiddenCount = options.hiddenCount ?? 2;
  const creature = new Creature(2, 1, {
    layers: [{ count: hiddenCount, squash: IDENTITY.NAME }],
    outputLayer: { squash: IDENTITY.NAME },
  });

  if (options.weights) {
    for (
      let i = 0;
      i < options.weights.length && i < creature.synapses.length;
      i++
    ) {
      creature.synapses[i].weight = options.weights[i];
    }
  }
  if (options.biases) {
    for (let i = 0; i < options.biases.length; i++) {
      const neuronIdx = creature.input + i;
      if (neuronIdx < creature.neurons.length) {
        creature.neurons[neuronIdx].bias = options.biases[i];
      }
    }
  }
  delete creature.cachedScoreComponents;
  return creature;
}

Deno.test("MaxRecalc: reducing max weight matches full recalculation", () => {
  // Set up creature where synapse 0 has the clear max weight
  const creature = createCreature({
    weights: [10, 2, 3, 1, 0.5, 0.5, 0.5],
    biases: [0.1, 0.1, 0.1],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // Populate cache
  calculate(creature, error, growthCost);

  // Reduce the max weight (synapse 0: 10 -> 1)
  const oldWeight = creature.synapses[0].weight;
  const newWeight = 1.0;
  creature.synapses[0].weight = newWeight;

  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Verify against full recalculation
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Reducing max weight should produce same score as full recalc",
  );
});

Deno.test("MaxRecalc: reducing max bias matches full recalculation", () => {
  // Set up creature where neuron 0 (first hidden) has the max bias
  const creature = createCreature({
    weights: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    biases: [15, 0.2, 0.3],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // Populate cache
  calculate(creature, error, growthCost);

  // Reduce the max bias
  const neuronIdx = creature.input;
  const oldBias = creature.neurons[neuronIdx].bias;
  const newBias = 0.1;
  creature.neurons[neuronIdx].bias = newBias;

  const incrementalScore = updateScoreForBiasChange(
    creature,
    error,
    growthCost,
    oldBias,
    newBias,
  );

  // Verify against full recalculation
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Reducing max bias should produce same score as full recalc",
  );
});

Deno.test("MaxRecalc: repeated max reductions match full recalculation", () => {
  // Start with a clear max and reduce it repeatedly
  const creature = createCreature({
    weights: [20, 8, 5, 3, 1, 0.5, 0.5],
    biases: [0.1, 0.1, 0.1],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // Populate cache
  calculate(creature, error, growthCost);

  // Reduce synapse 0 from 20 to 7 (new max should be synapse 1 at 8)
  let oldWeight = creature.synapses[0].weight;
  let newWeight = 7;
  creature.synapses[0].weight = newWeight;
  updateScoreForWeightChange(creature, error, growthCost, oldWeight, newWeight);

  // Now reduce synapse 1 from 8 to 4 (new max should be synapse 0 at 7)
  oldWeight = creature.synapses[1].weight;
  newWeight = 4;
  creature.synapses[1].weight = newWeight;
  updateScoreForWeightChange(creature, error, growthCost, oldWeight, newWeight);

  // Now reduce synapse 0 from 7 to 2 (new max should be synapse 2 at 5)
  oldWeight = creature.synapses[0].weight;
  newWeight = 2;
  creature.synapses[0].weight = newWeight;
  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Verify against full recalculation
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Repeated max reductions should produce same score as full recalc",
  );
});

Deno.test("MaxRecalc: max cached correctly after new weight exceeds current max", () => {
  const creature = createCreature({
    weights: [5, 3, 1, 0.5, 0.5, 0.5, 0.5],
    biases: [0.1, 0.1, 0.1],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // Populate cache
  calculate(creature, error, growthCost);
  assertEquals(creature.cachedScoreComponents!.maxWeightBias, 5);

  // Set a new max by increasing synapse 2
  const oldWeight = creature.synapses[2].weight;
  const newWeight = 50;
  creature.synapses[2].weight = newWeight;
  updateScoreForWeightChange(creature, error, growthCost, oldWeight, newWeight);

  assertEquals(
    creature.cachedScoreComponents!.maxWeightBias,
    50,
    "Max should be updated to the new larger weight",
  );

  // Now reduce it back - should find the original max (5)
  const oldWeight2 = creature.synapses[2].weight;
  const newWeight2 = 0.1;
  creature.synapses[2].weight = newWeight2;
  updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight2,
    newWeight2,
  );

  // Verify against full recalculation
  creature.invalidateScoreCache();
  calculate(creature, error, growthCost);
  assertEquals(
    creature.cachedScoreComponents!.maxWeightBias,
    5,
    "Max should revert to the next highest value after reduction",
  );
});

Deno.test("MaxRecalc: max correctly tracks bias as the global max", () => {
  // Set up where bias is the global max, not any weight
  const creature = createCreature({
    weights: [1, 1, 1, 1, 1, 1, 1],
    biases: [25, 0.1, 0.1],
  });
  const error = 0.1;
  const growthCost = 0.001;

  calculate(creature, error, growthCost);
  assertEquals(creature.cachedScoreComponents!.maxWeightBias, 25);

  // Reduce the bias - max should come from weights or other biases
  const neuronIdx = creature.input;
  const oldBias = creature.neurons[neuronIdx].bias;
  const newBias = 0.5;
  creature.neurons[neuronIdx].bias = newBias;

  updateScoreForBiasChange(creature, error, growthCost, oldBias, newBias);

  // Verify against full recalculation
  creature.invalidateScoreCache();
  calculate(creature, error, growthCost);
  assertEquals(
    creature.cachedScoreComponents!.maxWeightBias,
    1,
    "Max should be found from weights when bias is reduced",
  );
});

Deno.test("MaxRecalc: negative weights tracked by absolute value", () => {
  // The max is a negative weight (by absolute value)
  const creature = createCreature({
    weights: [-12, 3, 1, 0.5, 0.5, 0.5, 0.5],
    biases: [0.1, 0.1, 0.1],
  });
  const error = 0.1;
  const growthCost = 0.001;

  calculate(creature, error, growthCost);
  assertEquals(creature.cachedScoreComponents!.maxWeightBias, 12);

  // Reduce the absolute max (change -12 to -2)
  const oldWeight = creature.synapses[0].weight;
  const newWeight = -2;
  creature.synapses[0].weight = newWeight;
  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Verify against full recalculation
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Negative weight max reduction should match full recalc",
  );
  assertEquals(
    creature.cachedScoreComponents!.maxWeightBias,
    3,
    "New max should be 3 (next largest absolute value)",
  );
});

Deno.test("MaxRecalc: interleaved weight and bias mutations match full recalc", () => {
  const creature = createCreature({
    weights: [10, 5, 2, 1, 0.5, 0.5, 0.5],
    biases: [8, 3, 0.1],
  });
  const error = 0.1;
  const growthCost = 0.001;

  calculate(creature, error, growthCost);

  // Reduce max weight from 10 to 4
  let oldW = creature.synapses[0].weight;
  creature.synapses[0].weight = 4;
  updateScoreForWeightChange(creature, error, growthCost, oldW, 4);

  // Now bias (8) is the max. Reduce it to 3.
  const neuronIdx = creature.input;
  const oldB = creature.neurons[neuronIdx].bias;
  creature.neurons[neuronIdx].bias = 3;
  updateScoreForBiasChange(creature, error, growthCost, oldB, 3);

  // Now max should be synapse 1 at 5
  // Reduce synapse 1 from 5 to 1
  oldW = creature.synapses[1].weight;
  creature.synapses[1].weight = 1;
  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldW,
    1,
  );

  // Verify against full recalculation
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Interleaved weight and bias mutations should match full recalc",
  );
});

Deno.test("MaxRecalc: large creature max reduction matches full recalculation", () => {
  // Create a larger creature to test with more synapses
  const creature = new Creature(10, 3, {
    layers: [
      { count: 20, squash: IDENTITY.NAME },
      { count: 10, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });

  // Set a clear max on the first synapse
  creature.synapses[0].weight = 50;
  delete creature.cachedScoreComponents;

  const error = 0.1;
  const growthCost = 0.001;

  calculate(creature, error, growthCost);
  assertEquals(creature.cachedScoreComponents!.maxWeightBias, 50);

  // Reduce the max
  const oldWeight = creature.synapses[0].weight;
  const newWeight = 0.1;
  creature.synapses[0].weight = newWeight;

  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Verify against full recalculation
  creature.invalidateScoreCache();
  const fullRecalcScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullRecalcScore,
    "Large creature max reduction should match full recalc",
  );
});
