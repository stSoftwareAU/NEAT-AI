/**
 * Behavioural tests for Weight.ts — verifying weights converge towards
 * target values over multiple accumulate/calculate cycles, and that
 * batch size boundaries trigger proper recalculation.
 *
 * These are "what" tests: they exercise real functions with test data and
 * check outcomes, not implementation details.
 *
 * Closes #1440
 */
import { assertAlmostEquals, assertGreater, assertLess } from "@std/assert";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";
import {
  accumulateWeight,
  adjustedWeight,
  calculateWeight,
} from "../../src/propagate/Weight.ts";
import type { CreatureState } from "../../src/architecture/CreatureState.ts";
import type { Synapse } from "../../src/architecture/Synapse.ts";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function fakeSynapse(weight: number): Synapse {
  return { weight, from: 0, to: 1 } as Synapse;
}

// ---------------------------------------------------------------------------
// Weight convergence over multiple cycles
// ---------------------------------------------------------------------------

Deno.test("Weight convergence - repeated accumulation moves weight towards target", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const synapse = fakeSynapse(1.0);
  const cs = new SynapseState();

  // Accumulate many samples all pointing toward weight=3
  // (activation=1, targetValue=3 => implied weight = 3/1 = 3)
  for (let i = 0; i < 50; i++) {
    accumulateWeight(synapse.weight, cs, 3.0, 1.0, config);
  }

  const result = calculateWeight(cs, synapse, config);

  // The calculated weight should move towards 3.0 from the original 1.0
  assertGreater(result, 1.0, "Weight should increase towards target");
  assertLess(result, 3.1, "Weight should not overshoot the target");
});

Deno.test("Weight convergence - negative target moves weight downward", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const synapse = fakeSynapse(1.0);
  const cs = new SynapseState();

  // Accumulate samples pointing toward weight=-2
  // (activation=1, targetValue=-2 => implied weight = -2/1 = -2)
  for (let i = 0; i < 50; i++) {
    accumulateWeight(synapse.weight, cs, -2.0, 1.0, config);
  }

  const result = calculateWeight(cs, synapse, config);

  // The weight should move downward from 1.0 towards -2.0
  assertLess(result, 1.0, "Weight should decrease towards negative target");
});

Deno.test("Weight convergence - mixed activations converge to blended target", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const synapse = fakeSynapse(0.5);
  const cs = new SynapseState();

  // Mix of positive and negative activations, all aiming for weight=2
  for (let i = 0; i < 25; i++) {
    accumulateWeight(synapse.weight, cs, 2.0, 1.0, config); // positive
    accumulateWeight(synapse.weight, cs, -2.0, -1.0, config); // negative
  }

  const result = calculateWeight(cs, synapse, config);

  // With consistent target weight of 2, result should move toward 2
  assertGreater(result, 0.5, "Weight should increase from starting value");
});

// ---------------------------------------------------------------------------
// Batch boundary behaviour via adjustedWeight
// ---------------------------------------------------------------------------

Deno.test("adjustedWeight - returns original weight before batch boundary", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    batchSize: 10,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const synapse = fakeSynapse(0.5);

  // Create a mock CreatureState that returns our SynapseState
  const cs = new SynapseState();
  const mockState = {
    connection: (_from: number, _to: number) => cs,
  } as unknown as CreatureState;

  // Accumulate fewer samples than batchSize
  for (let i = 0; i < 5; i++) {
    accumulateWeight(synapse.weight, cs, 3.0, 1.0, config);
  }

  // Before reaching batch boundary, adjustedWeight should return original
  const result = adjustedWeight(mockState, synapse, config);
  assertAlmostEquals(
    result,
    0.5,
    1e-9,
    "Should return original weight before batch boundary",
  );
});

Deno.test("adjustedWeight - recalculates at batch boundary", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    batchSize: 10,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const synapse = fakeSynapse(0.5);

  const cs = new SynapseState();
  const mockState = {
    connection: (_from: number, _to: number) => cs,
  } as unknown as CreatureState;

  // Accumulate exactly batchSize samples pointing toward weight=3
  for (let i = 0; i < 10; i++) {
    accumulateWeight(synapse.weight, cs, 3.0, 1.0, config);
  }

  // At batch boundary (count % batchSize === 0), should recalculate
  const result = adjustedWeight(mockState, synapse, config);

  // The batch-recalculated weight should differ from the original
  assertGreater(result, 0.5, "Batch boundary should trigger recalculation");
});

Deno.test("adjustedWeight - disableWeightAdjustment returns original", () => {
  const config = createBackPropagationConfig({
    disableWeightAdjustment: true,
    generations: 0,
    learningRate: 1,
    batchSize: 1,
  });

  const synapse = fakeSynapse(0.5);

  const cs = new SynapseState();
  const mockState = {
    connection: (_from: number, _to: number) => cs,
  } as unknown as CreatureState;

  accumulateWeight(synapse.weight, cs, 10.0, 1.0, config);

  const result = adjustedWeight(mockState, synapse, config);
  assertAlmostEquals(
    result,
    0.5,
    1e-9,
    "Disabled adjustment should return original weight",
  );
});

// ---------------------------------------------------------------------------
// High-generation blending dampens adjustment
// ---------------------------------------------------------------------------

Deno.test("Weight convergence - higher generations dampen adjustment", () => {
  const lowGenConfig = createBackPropagationConfig({
    generations: 1,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const highGenConfig = createBackPropagationConfig({
    generations: 100,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100_000,
  });

  const synapse = fakeSynapse(1.0);

  // Low generations
  const csLow = new SynapseState();
  for (let i = 0; i < 10; i++) {
    accumulateWeight(synapse.weight, csLow, 5.0, 1.0, lowGenConfig);
  }
  const resultLow = calculateWeight(csLow, synapse, lowGenConfig);

  // High generations
  const csHigh = new SynapseState();
  for (let i = 0; i < 10; i++) {
    accumulateWeight(synapse.weight, csHigh, 5.0, 1.0, highGenConfig);
  }
  const resultHigh = calculateWeight(csHigh, synapse, highGenConfig);

  // More generations means more blending with original, so less change
  const changeLow = Math.abs(resultLow - 1.0);
  const changeHigh = Math.abs(resultHigh - 1.0);

  assertGreater(
    changeLow,
    changeHigh,
    "Higher generations should dampen the weight adjustment",
  );
});
