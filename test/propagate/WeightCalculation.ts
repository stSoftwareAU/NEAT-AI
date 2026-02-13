/**
 * Unit tests for Weight.ts - calculateWeight, accumulateWeight direction and
 * magnitude, limitWeight boundary conditions.
 *
 * Closes #1399
 */
import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
} from "@std/assert";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";
import {
  accumulateWeight,
  calculateWeight,
  limitWeight,
} from "../../src/propagate/Weight.ts";
import type { Synapse } from "../../src/architecture/Synapse.ts";

// ---------------------------------------------------------------------------
// Helper: create a minimal synapse-like object for calculateWeight
// ---------------------------------------------------------------------------
function fakeSynapse(weight: number): Synapse {
  return { weight, from: 0, to: 1 } as Synapse;
}

// ---------------------------------------------------------------------------
// accumulateWeight - direction and magnitude
// ---------------------------------------------------------------------------

Deno.test("accumulateWeight - positive activation tracks positive contribution", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();

  accumulateWeight(0.5, cs, 2.0, 1.0, config);

  assertEquals(cs.count, 1);
  assertEquals(cs.countPositiveActivations, 1);
  assertEquals(cs.countNegativeActivations, 0);
  assertGreater(cs.totalPositiveActivation, 0);
});

Deno.test("accumulateWeight - negative activation tracks negative contribution", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();

  accumulateWeight(0.5, cs, -2.0, -1.0, config);

  assertEquals(cs.count, 1);
  assertEquals(cs.countPositiveActivations, 0);
  assertEquals(cs.countNegativeActivations, 1);
  assertGreater(cs.totalNegativeActivation, 0);
});

Deno.test("accumulateWeight - zero activation still increments count", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.0001,
  });
  const cs = new SynapseState();

  accumulateWeight(0.5, cs, 1.0, 0, config);

  // Zero activation is below plankConstant, so positive/negative counts
  // should not increase, but overall count should still increase.
  assertEquals(cs.count, 1);
  assertEquals(cs.countPositiveActivations, 0);
  assertEquals(cs.countNegativeActivations, 0);
});

Deno.test("accumulateWeight - skips non-finite activation", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();

  accumulateWeight(0.5, cs, 1.0, NaN, config);
  assertEquals(cs.count, 0, "NaN activation should be skipped");

  accumulateWeight(0.5, cs, 1.0, Infinity, config);
  assertEquals(cs.count, 0, "Infinity activation should be skipped");
});

Deno.test("accumulateWeight - skips non-finite targetValue", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();

  accumulateWeight(0.5, cs, Infinity, 1.0, config);
  assertEquals(cs.count, 0, "Infinity target should be skipped");
});

Deno.test("accumulateWeight - skips non-finite currentWeight", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();

  accumulateWeight(NaN, cs, 1.0, 1.0, config);
  assertEquals(cs.count, 0, "NaN currentWeight should be skipped");
});

// ---------------------------------------------------------------------------
// accumulateWeight - multiple accumulations
// ---------------------------------------------------------------------------

Deno.test("accumulateWeight - accumulates multiple samples correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();

  // Three positive activations
  accumulateWeight(1.0, cs, 2.0, 1.0, config);
  accumulateWeight(1.0, cs, 3.0, 2.0, config);
  accumulateWeight(1.0, cs, 1.0, 0.5, config);

  assertEquals(cs.count, 3);
  assertEquals(cs.countPositiveActivations, 3);
  assertEquals(cs.countNegativeActivations, 0);
});

// ---------------------------------------------------------------------------
// calculateWeight
// ---------------------------------------------------------------------------

Deno.test("calculateWeight - returns original weight when disableWeightAdjustment is true", () => {
  const config = createBackPropagationConfig({
    disableWeightAdjustment: true,
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();
  const synapse = fakeSynapse(0.5);

  // Accumulate some data
  accumulateWeight(0.5, cs, 2.0, 1.0, config);

  const result = calculateWeight(cs, synapse, config);
  assertAlmostEquals(result, 0.5, 1e-9);
});

Deno.test("calculateWeight - returns original weight when count is zero", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();
  const synapse = fakeSynapse(0.7);

  const result = calculateWeight(cs, synapse, config);
  assertAlmostEquals(result, 0.7, 1e-9);
});

Deno.test("calculateWeight - blends with generational weight", () => {
  const config = createBackPropagationConfig({
    generations: 10,
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100000,
  });
  const cs = new SynapseState();
  const synapse = fakeSynapse(1.0);

  // Accumulate with positive activation pointing toward weight=2
  accumulateWeight(1.0, cs, 2.0, 1.0, config);

  const result = calculateWeight(cs, synapse, config);

  // With generations=10 and one sample, the result should be blended
  // between the sample's implied weight (~2) and the original weight (1.0).
  // The blend favours the original because generations >> sample count.
  assertGreater(result, 1.0, "Should shift toward target");
  assertLess(result, 2.0, "Should not overshoot target");
});

// ---------------------------------------------------------------------------
// limitWeight - edge cases
// ---------------------------------------------------------------------------

Deno.test("limitWeight - returns 0 for tiny target", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    plankConstant: 0.0001,
  });

  const result = limitWeight(0.00001, 0.5, config);
  assertEquals(result, 0, "Weight below plankConstant should return 0");
});

Deno.test("limitWeight - returns currentWeight when difference is tiny", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    plankConstant: 0.0001,
  });

  const current = 0.5;
  const target = current + 0.00001; // difference < plankConstant
  const result = limitWeight(target, current, config);
  assertAlmostEquals(result, current, 1e-9);
});

Deno.test("limitWeight - learning rate scales the adjustment", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.5,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 100000,
  });

  // target=3, current=1, diff=2, scaled diff=0.5*2=1 => result=2
  const result = limitWeight(3, 1, config);
  assertAlmostEquals(result, 2, 1e-9);
});

Deno.test("limitWeight - clamps to maximumWeightAdjustmentScale", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumWeightAdjustmentScale: 0.1,
    limitWeightScale: 100000,
  });

  // target=10, current=0 => diff=10, but clamped to +0.1
  const result = limitWeight(10, 0, config);
  assertAlmostEquals(result, 0.1, 1e-9);
});

Deno.test("limitWeight - clamps negative direction to maximumWeightAdjustmentScale", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumWeightAdjustmentScale: 0.1,
    limitWeightScale: 100000,
  });

  // target=-10, current=0 => diff=-10, clamped to -0.1
  const result = limitWeight(-10, 0, config);
  assertAlmostEquals(result, -0.1, 1e-9);
});

Deno.test("limitWeight - enforces limitWeightScale ceiling", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 5,
  });

  // target=10, current=4 => diff=6, adjusted to 10, but clamped to 5
  const result = limitWeight(10, 4, config);
  assertAlmostEquals(result, 5, 1e-9);
});

Deno.test("limitWeight - enforces negative limitWeightScale floor", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumWeightAdjustmentScale: 100,
    limitWeightScale: 5,
  });

  // target=-10, current=-4 => result clamped to -5
  const result = limitWeight(-10, -4, config);
  assertAlmostEquals(result, -5, 1e-9);
});

Deno.test("limitWeight - zero gradient returns currentWeight", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    plankConstant: 0.0001,
  });

  // target == current => no change
  const result = limitWeight(0.5, 0.5, config);
  assertAlmostEquals(result, 0.5, 1e-9);
});
