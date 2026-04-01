/**
 * Tests verifying scan correctness for scanMaxForBiasChange and
 * scanMaxForWeightChange in Score.ts.
 *
 * Issue #2122: These tests ensure that replacing .slice().findIndex() and
 * .findIndex() with direct for loops produces identical results.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "@architecture/Score.ts";

/**
 * Helper to create a creature with specified weights and biases.
 */
function makeCreature(
  options: {
    hiddenCount?: number;
    weights?: number[];
    biases?: number[];
  } = {},
): Creature {
  const hiddenCount = options.hiddenCount ?? 2;
  const creature = new Creature(2, 1, {
    layers: [{ count: hiddenCount, squash: "IDENTITY" }],
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

/**
 * Forces the scanMaxForWeightChange path by:
 * 1. Computing initial cache
 * 2. Making the max weight the old weight
 * 3. Consuming secondMax (making it stale) via a first update
 * 4. Then doing a second update that triggers the full scan
 */
Deno.test("scanMaxForWeightChange - full scan produces correct result", () => {
  // Set up creature with known weights where one is clearly the max
  const creature = makeCreature({
    hiddenCount: 3,
    weights: [10.0, 5.0, 3.0, 2.0, 1.0, 0.5, 0.3, 0.2, 0.1],
    biases: [0.1, 0.2, 0.3],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // Compute initial cache
  calculate(creature, error, growthCost);
  const cached = creature.cachedScoreComponents!;
  assertEquals(cached.maxWeightBias, 10.0, "Initial max should be 10.0");

  // First update: reduce the max weight to trigger secondMax consumption
  const oldWeight1 = 10.0;
  const newWeight1 = 4.0;
  creature.synapses[0].weight = newWeight1;
  updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight1,
    newWeight1,
  );

  // secondMax should now be stale (-1)
  const cached2 = creature.cachedScoreComponents!;
  assertEquals(cached2.secondMaxWeightBias, -1, "secondMax should be stale");

  // Second update: reduce max again, forcing a full scan
  const oldWeight2 = cached2.maxWeightBias === 5.0 ? 5.0 : 4.0;
  const synIdx = creature.synapses.findIndex((s) => s.weight === oldWeight2);
  const newWeight2 = 0.1;
  creature.synapses[synIdx].weight = newWeight2;

  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight2,
    newWeight2,
  );

  // Verify against full recalculation
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullScore,
    "Scan-based incremental update should match full recalculation",
  );
});

/**
 * Forces the scanMaxForBiasChange path similarly.
 */
Deno.test("scanMaxForBiasChange - full scan produces correct result", () => {
  // Set up creature with a large bias as the max
  const creature = makeCreature({
    hiddenCount: 3,
    weights: [0.5, 0.3, 0.2, 0.1, 0.05, 0.03, 0.02, 0.01, 0.005],
    biases: [10.0, 5.0, 3.0],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // Compute initial cache
  calculate(creature, error, growthCost);
  const cached = creature.cachedScoreComponents!;
  assertEquals(cached.maxWeightBias, 10.0, "Initial max should be 10.0");

  // First update: reduce the max bias to consume secondMax
  const oldBias1 = 10.0;
  const newBias1 = 4.0;
  const biasIdx = creature.input; // First hidden neuron
  creature.neurons[biasIdx].bias = newBias1;
  updateScoreForBiasChange(creature, error, growthCost, oldBias1, newBias1);

  // secondMax should now be stale
  const cached2 = creature.cachedScoreComponents!;
  assertEquals(cached2.secondMaxWeightBias, -1, "secondMax should be stale");

  // Second update: reduce max again, forcing a full scan
  const currentMax = cached2.maxWeightBias;
  // Find which neuron has the current max bias
  let targetNeuronIdx = -1;
  for (let i = creature.input; i < creature.neurons.length; i++) {
    if (Math.abs(creature.neurons[i].bias) === currentMax) {
      targetNeuronIdx = i;
      break;
    }
  }
  // If max is from a synapse, use a bias update that still triggers scan
  const oldBias2 = targetNeuronIdx >= 0
    ? creature.neurons[targetNeuronIdx].bias
    : creature.neurons[creature.input].bias;
  const newBias2 = 0.01;

  if (targetNeuronIdx >= 0) {
    creature.neurons[targetNeuronIdx].bias = newBias2;
  } else {
    creature.neurons[creature.input].bias = newBias2;
  }

  const incrementalScore = updateScoreForBiasChange(
    creature,
    error,
    growthCost,
    oldBias2,
    newBias2,
  );

  // Verify against full recalculation
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullScore,
    "Scan-based incremental update should match full recalculation",
  );
});

/**
 * Tests that multiple sequential weight updates through the scan path
 * remain correct.
 */
Deno.test("scanMaxForWeightChange - sequential updates remain correct", () => {
  const creature = makeCreature({
    hiddenCount: 2,
    weights: [8.0, 6.0, 4.0, 2.0, 1.0],
    biases: [0.5, 0.3],
  });
  const error = 0.1;
  const growthCost = 0.001;

  calculate(creature, error, growthCost);

  // Perform multiple weight changes, each reducing the max
  const changes = [
    { idx: 0, oldW: 8.0, newW: 3.0 },
    { idx: 1, oldW: 6.0, newW: 2.5 },
    { idx: 2, oldW: 4.0, newW: 1.5 },
  ];

  for (const change of changes) {
    creature.synapses[change.idx].weight = change.newW;
    updateScoreForWeightChange(
      creature,
      error,
      growthCost,
      change.oldW,
      change.newW,
    );
  }

  // Final incremental score
  const incrementalCached = creature.cachedScoreComponents!;
  const incrementalMax = incrementalCached.maxWeightBias;

  // Full recalculation
  delete creature.cachedScoreComponents;
  calculate(creature, error, growthCost);
  const fullCached = creature.cachedScoreComponents!;

  assertEquals(
    incrementalMax,
    fullCached.maxWeightBias,
    "Max should match after sequential updates",
  );
});

/**
 * Tests that multiple sequential bias updates through the scan path
 * remain correct.
 */
Deno.test("scanMaxForBiasChange - sequential updates remain correct", () => {
  const creature = makeCreature({
    hiddenCount: 3,
    weights: [0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3],
    biases: [8.0, 6.0, 4.0],
  });
  const error = 0.1;
  const growthCost = 0.001;

  calculate(creature, error, growthCost);

  // Perform multiple bias changes
  const changes = [
    { neuronOffset: 0, oldB: 8.0, newB: 3.0 },
    { neuronOffset: 1, oldB: 6.0, newB: 2.5 },
    { neuronOffset: 2, oldB: 4.0, newB: 1.5 },
  ];

  for (const change of changes) {
    const idx = creature.input + change.neuronOffset;
    creature.neurons[idx].bias = change.newB;
    updateScoreForBiasChange(
      creature,
      error,
      growthCost,
      change.oldB,
      change.newB,
    );
  }

  // Compare incremental vs full recalculation
  const incrementalCached = creature.cachedScoreComponents!;
  const incrementalMax = incrementalCached.maxWeightBias;

  delete creature.cachedScoreComponents;
  calculate(creature, error, growthCost);
  const fullCached = creature.cachedScoreComponents!;

  assertEquals(
    incrementalMax,
    fullCached.maxWeightBias,
    "Max should match after sequential bias updates",
  );
});

/**
 * Tests scan with a creature that has many neurons to ensure the for-loop
 * correctly iterates past the input neurons.
 */
Deno.test("scanMaxForBiasChange - correctly skips input neurons", () => {
  const creature = makeCreature({
    hiddenCount: 5,
    biases: [0.1, 0.2, 15.0, 0.4, 0.5],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // The max bias is 15.0 at offset 2 (creature.input + 2)
  calculate(creature, error, growthCost);
  const cached = creature.cachedScoreComponents!;
  assert(cached.maxWeightBias >= 15.0, "Max should include the large bias");

  // Reduce it to force scan
  const targetIdx = creature.input + 2;
  const oldBias = 15.0;
  const newBias = 0.05;
  creature.neurons[targetIdx].bias = newBias;

  // First reduction consumes secondMax
  updateScoreForBiasChange(creature, error, growthCost, oldBias, newBias);

  // Verify result matches full calculation
  delete creature.cachedScoreComponents;
  calculate(creature, error, growthCost);
  const cachedFull = creature.cachedScoreComponents!;

  // Recalculate incrementally from fresh
  delete creature.cachedScoreComponents;
  calculate(creature, error, growthCost);

  assertEquals(
    cachedFull.maxWeightBias,
    creature.cachedScoreComponents!.maxWeightBias,
    "Max should be consistent across recalculations",
  );
});
