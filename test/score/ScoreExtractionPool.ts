/**
 * Unit tests for Score extraction buffer pooling.
 * Issue #2046: Verify that pooled Float64Array buffers produce correct results
 * across creatures of varying sizes.
 */

import { assertEquals } from "@std/assert";
import { Creature } from "../../mod.ts";
import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
} from "../../src/architecture/Score.ts";
import { IDENTITY } from "../../src/methods/activations/types/IDENTITY.ts";

/**
 * Helper to create a creature with a specific number of hidden neurons.
 */
function makeCreature(hiddenCount: number): Creature {
  const creature = new Creature(2, 1, {
    layers: [{ count: hiddenCount, squash: IDENTITY.NAME }],
  });
  // Set distinctive weights and biases for verification
  for (let i = 0; i < creature.synapses.length; i++) {
    creature.synapses[i].weight = 0.1 * (i + 1);
  }
  for (let i = creature.input; i < creature.neurons.length; i++) {
    creature.neurons[i].bias = 0.05 * (i - creature.input + 1);
  }
  delete creature.cachedScoreComponents;
  return creature;
}

Deno.test("pool - varying creature sizes produce consistent scores", () => {
  const error = 0.1;
  const growthCost = 0.001;

  // Calculate scores for creatures of increasing size (pool must grow)
  const sizes = [2, 10, 5, 20, 3];
  for (const size of sizes) {
    const creature = makeCreature(size);
    const score1 = calculate(creature, error, growthCost);

    // Clear cache and recalculate — must match
    delete creature.cachedScoreComponents;
    const score2 = calculate(creature, error, growthCost);

    assertEquals(
      score1,
      score2,
      `Score mismatch for creature with ${size} hidden neurons`,
    );
  }
});

Deno.test("pool - smaller creature after larger still correct", () => {
  const error = 0.1;
  const growthCost = 0.001;

  // First use a large creature to grow the pool
  const large = makeCreature(50);
  const largeScore = calculate(large, error, growthCost);

  // Then a small creature — pool buffer is larger than needed
  const small = makeCreature(2);
  const smallScore = calculate(small, error, growthCost);

  // Verify both are deterministic
  delete large.cachedScoreComponents;
  assertEquals(
    largeScore,
    calculate(large, error, growthCost),
    "Large creature score should be deterministic",
  );

  delete small.cachedScoreComponents;
  assertEquals(
    smallScore,
    calculate(small, error, growthCost),
    "Small creature score should be deterministic after large",
  );
});

Deno.test("pool - incremental weight update correct after pool reuse", () => {
  const error = 0.1;
  const growthCost = 0.001;

  // Grow the pool with a large creature
  const large = makeCreature(30);
  calculate(large, error, growthCost);

  // Now use a small creature with incremental update
  const small = makeCreature(3);
  calculate(small, error, growthCost);

  const oldWeight = small.synapses[0].weight;
  const newWeight = 5.0;
  small.synapses[0].weight = newWeight;

  // Force scan path by making secondMax stale
  small.cachedScoreComponents!.secondMaxWeightBias = -1;

  const incrementalScore = updateScoreForWeightChange(
    small,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  delete small.cachedScoreComponents;
  const fullScore = calculate(small, error, growthCost);

  assertEquals(
    incrementalScore,
    fullScore,
    "Incremental weight update should match full recalculation after pool reuse",
  );
});

Deno.test("pool - incremental bias update correct after pool reuse", () => {
  const error = 0.1;
  const growthCost = 0.001;

  // Grow the pool with a large creature
  const large = makeCreature(30);
  calculate(large, error, growthCost);

  // Now use a small creature with incremental update
  const small = makeCreature(3);
  calculate(small, error, growthCost);

  const targetIdx = small.input;
  const oldBias = small.neurons[targetIdx].bias;
  const newBias = 8.0;
  small.neurons[targetIdx].bias = newBias;

  // Force scan path
  small.cachedScoreComponents!.secondMaxWeightBias = -1;

  const incrementalScore = updateScoreForBiasChange(
    small,
    error,
    growthCost,
    oldBias,
    newBias,
  );

  delete small.cachedScoreComponents;
  const fullScore = calculate(small, error, growthCost);

  assertEquals(
    incrementalScore,
    fullScore,
    "Incremental bias update should match full recalculation after pool reuse",
  );
});
