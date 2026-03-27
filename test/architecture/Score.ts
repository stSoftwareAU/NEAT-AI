/**
 * Unit tests for Score module.
 *
 * Issue #1407: Targeted unit tests for architecture core - fitness scoring
 * calculations including penalty computation, caching, and incremental updates.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "../../mod.ts";
import {
  calculate,
  updateScoreForBiasChange,
  updateScoreForWeightChange,
  valuePenalty,
} from "../../src/architecture/Score.ts";

/**
 * Helper to create a simple creature with specified weights and biases.
 */
function makeCreature(
  options: {
    hiddenCount?: number;
    weights?: number[];
    biases?: number[];
  } = {},
): Creature {
  const hiddenCount = options.hiddenCount ?? 1;
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
  // Clear any cached score components so they're recomputed
  delete creature.cachedScoreComponents;

  return creature;
}

// --- valuePenalty tests ---

Deno.test("valuePenalty - returns 0 for values <= 1", () => {
  assertEquals(valuePenalty(0), 0);
  assertEquals(valuePenalty(0.5), 0);
  assertEquals(valuePenalty(1), 0);
});

Deno.test("valuePenalty - returns positive penalty for values > 1", () => {
  const penalty = valuePenalty(2);
  assert(penalty > 0, "Penalty should be positive for value > 1");
  assert(penalty < 1, "Penalty should be less than 1");
});

Deno.test("valuePenalty - penalty increases with value", () => {
  const p2 = valuePenalty(2);
  const p10 = valuePenalty(10);
  const p100 = valuePenalty(100);

  assert(p10 > p2, "Penalty for 10 should exceed penalty for 2");
  assert(p100 > p10, "Penalty for 100 should exceed penalty for 10");
});

Deno.test("valuePenalty - penalty is always less than 1", () => {
  const p1000 = valuePenalty(1000);
  const p10000 = valuePenalty(10000);

  assert(p1000 < 1, "Penalty for 1000 should be less than 1");
  assert(p10000 < 1, "Penalty for 10000 should be less than 1");
});

Deno.test("valuePenalty - compression kicks in for very large values", () => {
  // For very large values, penalty > 0.999 triggers compression
  const pLarge = valuePenalty(100000);
  assert(pLarge >= 0.999, "Large value penalty should reach compression zone");
  assert(pLarge < 1, "Even compressed penalty must be < 1");
});

Deno.test("valuePenalty - throws for negative values", () => {
  assertThrows(
    () => valuePenalty(-1),
    Error,
    "negative",
  );
});

// --- calculate tests ---

Deno.test("calculate - basic score with zero error and small weights", () => {
  const creature = makeCreature({
    weights: [0.5, 0.5, 0.5],
    biases: [0.1, 0.1],
  });
  const score = calculate(creature, 0, 0.0001);

  assert(score > 0, "Score should be positive with zero error");
  assert(score <= 1, "Score should not exceed 1");
});

Deno.test("calculate - higher error produces lower score", () => {
  const creature1 = makeCreature({ weights: [0.5], biases: [0.1] });
  const creature2 = makeCreature({ weights: [0.5], biases: [0.1] });

  const score1 = calculate(creature1, 0.1, 0.0001);
  const score2 = calculate(creature2, 0.5, 0.0001);

  assert(score1 > score2, "Lower error should yield higher score");
});

Deno.test("calculate - higher growth cost reduces score", () => {
  const creature1 = makeCreature({ weights: [0.5], biases: [0.1] });
  const creature2 = makeCreature({ weights: [0.5], biases: [0.1] });

  const score1 = calculate(creature1, 0.1, 0.0001);
  const score2 = calculate(creature2, 0.1, 0.01);

  assert(score1 > score2, "Lower growth cost should yield higher score");
});

Deno.test("calculate - more hidden neurons increase complexity penalty", () => {
  const creature1 = makeCreature({ hiddenCount: 1 });
  const creature2 = makeCreature({ hiddenCount: 5 });

  const score1 = calculate(creature1, 0.1, 0.001);
  const score2 = calculate(creature2, 0.1, 0.001);

  assert(
    score1 > score2,
    "Fewer hidden neurons should yield higher score (less complexity)",
  );
});

Deno.test("calculate - large weights increase penalty", () => {
  const creature1 = makeCreature({ weights: [0.5, 0.5, 0.5] });
  const creature2 = makeCreature({ weights: [50, 50, 50] });

  const score1 = calculate(creature1, 0.1, 0.001);
  const score2 = calculate(creature2, 0.1, 0.001);

  assert(
    score1 > score2,
    "Smaller weights should yield higher score (less penalty)",
  );
});

Deno.test("calculate - throws for NaN error", () => {
  const creature = makeCreature();
  assertThrows(
    () => calculate(creature, NaN, 0.001),
    Error,
    "NaN",
  );
});

Deno.test("calculate - throws for negative error", () => {
  const creature = makeCreature();
  assertThrows(
    () => calculate(creature, -0.1, 0.001),
    Error,
    "negative",
  );
});

Deno.test("calculate - throws for infinite error", () => {
  const creature = makeCreature();
  assertThrows(
    () => calculate(creature, Infinity, 0.001),
    Error,
    "not finite",
  );
});

Deno.test("calculate - caches score components", () => {
  const creature = makeCreature({ weights: [0.5], biases: [0.1] });

  calculate(creature, 0.1, 0.001);
  assert(
    creature.cachedScoreComponents !== undefined,
    "Score components should be cached after calculation",
  );
});

Deno.test("calculate - repeated calls with same inputs produce same score", () => {
  const creature = makeCreature({ weights: [0.5], biases: [0.1] });

  const score1 = calculate(creature, 0.1, 0.001);

  // Second call uses cached components - should produce identical result
  const score2 = calculate(creature, 0.1, 0.001);
  assertEquals(score1, score2, "Same inputs should produce same score");

  // Verify by clearing cache and recalculating from scratch
  delete creature.cachedScoreComponents;
  const score3 = calculate(creature, 0.1, 0.001);
  assertEquals(score1, score3, "Fresh calculation should match cached result");
});

Deno.test("calculate - zero growth cost produces score near 1 - error", () => {
  const creature = makeCreature({ weights: [0.5], biases: [0.1] });
  const error = 0.2;
  const score = calculate(creature, error, 0);

  // With zero growth cost, score should be approximately 1 - error
  // (only version penalty may apply)
  assert(
    Math.abs(score - (1 - error)) < 0.01,
    `Score ${score} should be close to ${1 - error} with zero growth cost`,
  );
});

// --- updateScoreForWeightChange tests ---

Deno.test("updateScoreForWeightChange - incremental update matches full recalculation", () => {
  const creature = makeCreature({ weights: [0.5, 0.3, 0.7], biases: [0.1] });
  const error = 0.1;
  const growthCost = 0.001;

  // Compute initial score
  calculate(creature, error, growthCost);

  // Update weight incrementally
  const oldWeight = creature.synapses[0].weight;
  creature.synapses[0].weight = 0.8;

  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    0.8,
  );

  // Full recalculation with same weights should match
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullScore,
    "Incremental update should match full recalculation",
  );
});

Deno.test("updateScoreForWeightChange - large weight increase lowers score", () => {
  const creature = makeCreature({ weights: [0.5, 0.3, 0.7], biases: [0.1] });
  const error = 0.1;
  const growthCost = 0.001;

  const initialScore = calculate(creature, error, growthCost);

  const oldWeight = creature.synapses[0].weight;
  const newWeight = 100; // Much larger than current max
  creature.synapses[0].weight = newWeight;

  const updatedScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  assert(
    updatedScore < initialScore,
    `Large weight should lower score: ${updatedScore} should be < ${initialScore}`,
  );
});

Deno.test("updateScoreForWeightChange - throws for NaN error", () => {
  const creature = makeCreature();
  calculate(creature, 0.1, 0.001);

  assertThrows(
    () => updateScoreForWeightChange(creature, NaN, 0.001, 0.5, 0.6),
    Error,
    "NaN",
  );
});

Deno.test("updateScoreForWeightChange - throws for non-finite weight", () => {
  const creature = makeCreature();
  calculate(creature, 0.1, 0.001);

  assertThrows(
    () => updateScoreForWeightChange(creature, 0.1, 0.001, 0.5, Infinity),
    Error,
    "not finite",
  );
});

// --- updateScoreForBiasChange tests ---

Deno.test("updateScoreForBiasChange - incremental update matches full recalculation", () => {
  const creature = makeCreature({
    weights: [0.5, 0.3, 0.7],
    biases: [0.1, 0.2],
  });
  const error = 0.1;
  const growthCost = 0.001;

  calculate(creature, error, growthCost);

  const oldBias = creature.neurons[creature.input].bias;
  creature.neurons[creature.input].bias = 0.5;

  const incrementalScore = updateScoreForBiasChange(
    creature,
    error,
    growthCost,
    oldBias,
    0.5,
  );

  // Full recalculation with same bias should match
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullScore,
    "Incremental update should match full recalculation",
  );
});

Deno.test("updateScoreForBiasChange - large bias increase lowers score", () => {
  const creature = makeCreature({ weights: [0.5], biases: [0.1] });
  const error = 0.1;
  const growthCost = 0.001;

  const initialScore = calculate(creature, error, growthCost);

  const oldBias = creature.neurons[creature.input].bias;
  const newBias = 200; // Much larger than current max
  creature.neurons[creature.input].bias = newBias;

  const updatedScore = updateScoreForBiasChange(
    creature,
    error,
    growthCost,
    oldBias,
    newBias,
  );

  assert(
    updatedScore < initialScore,
    `Large bias should lower score: ${updatedScore} should be < ${initialScore}`,
  );
});

Deno.test("updateScoreForBiasChange - throws for non-finite bias", () => {
  const creature = makeCreature();
  calculate(creature, 0.1, 0.001);

  assertThrows(
    () => updateScoreForBiasChange(creature, 0.1, 0.001, 0.5, NaN),
    Error,
    "not finite",
  );
});

// --- Issue #2042: Scan path tests (stale secondMax forces full scan) ---

Deno.test("updateScoreForBiasChange - scan path matches full recalculation when secondMax is stale", () => {
  // Create creature with multiple neurons so the scan has work to do
  const creature = makeCreature({
    hiddenCount: 5,
    weights: [0.5, 0.3, 0.7, 0.2, 0.4, 0.6, 0.8, 0.1, 0.9, 0.35],
    biases: [10, 0.2, 0.3, 0.4, 0.5],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // Populate cache
  calculate(creature, error, growthCost);

  // Force secondMax stale so the scan path is triggered
  creature.cachedScoreComponents!.secondMaxWeightBias = -1;

  // Change the max bias (10) to a small value - triggers scanMaxForBiasChange
  const oldBias = 10;
  const newBias = 0.05;
  creature.neurons[creature.input].bias = newBias;

  const incrementalScore = updateScoreForBiasChange(
    creature,
    error,
    growthCost,
    oldBias,
    newBias,
  );

  // Full recalculation should match
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullScore,
    "Scan path bias update should match full recalculation",
  );
});

Deno.test("updateScoreForWeightChange - scan path matches full recalculation when secondMax is stale", () => {
  const creature = makeCreature({
    hiddenCount: 3,
    weights: [10, 0.3, 0.7, 0.2, 0.4, 0.6],
    biases: [0.1, 0.2, 0.3],
  });
  const error = 0.1;
  const growthCost = 0.001;

  // Populate cache
  calculate(creature, error, growthCost);

  // Force secondMax stale
  creature.cachedScoreComponents!.secondMaxWeightBias = -1;

  // Change the max weight (10) to a small value - triggers scanMaxForWeightChange
  const oldWeight = 10;
  const newWeight = 0.05;
  creature.synapses[0].weight = newWeight;

  const incrementalScore = updateScoreForWeightChange(
    creature,
    error,
    growthCost,
    oldWeight,
    newWeight,
  );

  // Full recalculation should match
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, error, growthCost);

  assertEquals(
    incrementalScore,
    fullScore,
    "Scan path weight update should match full recalculation",
  );
});

Deno.test("updateScoreForBiasChange - works without prior calculate call", () => {
  const creature = makeCreature({ weights: [0.5], biases: [0.1] });

  // Don't call calculate first - updateScoreForBiasChange should still work
  creature.neurons[creature.input].bias = 0.2;
  const incrementalScore = updateScoreForBiasChange(
    creature,
    0.1,
    0.001,
    0.1,
    0.2,
  );

  // Verify by full recalculation
  delete creature.cachedScoreComponents;
  const fullScore = calculate(creature, 0.1, 0.001);

  assertEquals(
    incrementalScore,
    fullScore,
    "Score without prior cache should match full calculation",
  );
});
