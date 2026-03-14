import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
  assertThrows,
} from "@std/assert";
import {
  accumulateWeight,
  calculateWeight,
  limitWeight,
} from "../../src/propagate/Weight.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";
import type { Synapse } from "../../src/architecture/Synapse.ts";

function makeConfig(
  overrides?: Record<string, unknown>,
) {
  return createBackPropagationConfig({
    disableRandomSamples: true,
    learningRate: 0.1,
    generations: 1,
    maximumWeightAdjustmentScale: 10,
    limitWeightScale: 100_000,
    plankConstant: 1e-7,
    batchSize: 1,
    learningRateStrategy: "fixed",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Helper: create a minimal synapse-like object for calculateWeight
// ---------------------------------------------------------------------------
function fakeSynapse(weight: number): Synapse {
  return { weight, from: 0, to: 1 } as Synapse;
}

// --- accumulateWeight ---

Deno.test("accumulateWeight - positive activation tracks correctly", () => {
  const cs = new SynapseState();
  const config = makeConfig();
  accumulateWeight(0.5, cs, 1.0, 2.0, config);

  assertEquals(cs.count, 1);
  assertEquals(cs.countPositiveActivations, 1);
  assertEquals(cs.countNegativeActivations, 0);
  assert(cs.totalPositiveActivation > 0);
});

Deno.test("accumulateWeight - negative activation tracks correctly", () => {
  const cs = new SynapseState();
  const config = makeConfig();
  accumulateWeight(0.5, cs, 1.0, -2.0, config);

  assertEquals(cs.count, 1);
  assertEquals(cs.countNegativeActivations, 1);
  assertEquals(cs.countPositiveActivations, 0);
  assert(cs.totalNegativeActivation > 0);
});

Deno.test("accumulateWeight - skips NaN activation", () => {
  const cs = new SynapseState();
  accumulateWeight(0.5, cs, 1.0, NaN, makeConfig());
  assertEquals(cs.count, 0);
});

Deno.test("accumulateWeight - skips Infinity targetValue", () => {
  const cs = new SynapseState();
  accumulateWeight(0.5, cs, Infinity, 1.0, makeConfig());
  assertEquals(cs.count, 0);
});

Deno.test("accumulateWeight - skips NaN currentWeight", () => {
  const cs = new SynapseState();
  accumulateWeight(NaN, cs, 1.0, 1.0, makeConfig());
  assertEquals(cs.count, 0);
});

Deno.test("accumulateWeight - tiny activation uses plankConstant", () => {
  const cs = new SynapseState();
  const config = makeConfig({ plankConstant: 1e-7 });
  // activation = 1e-10 which is < plankConstant, so tmpActivation = plankConstant * sign
  accumulateWeight(0.5, cs, 1.0, 1e-10, config);
  // Still counts (activation is below plank but not below it for tracking)
  assertEquals(cs.count, 1);
});

Deno.test("accumulateWeight - zero activation still increments count", () => {
  const cs = new SynapseState();
  const config = makeConfig();
  accumulateWeight(0.5, cs, 1.0, 0, config);
  // Count is incremented but no positive/negative tracking (activation == 0 < plankConstant)
  assertEquals(cs.count, 1);
  assertEquals(cs.countPositiveActivations, 0);
  assertEquals(cs.countNegativeActivations, 0);
});

Deno.test("accumulateWeight - multiple accumulations", () => {
  const cs = new SynapseState();
  const config = makeConfig();
  accumulateWeight(0.5, cs, 1.0, 2.0, config);
  accumulateWeight(0.5, cs, 1.0, -3.0, config);
  accumulateWeight(0.5, cs, 1.0, 1.5, config);

  assertEquals(cs.count, 3);
  assertEquals(cs.countPositiveActivations, 2);
  assertEquals(cs.countNegativeActivations, 1);
});

// --- limitWeight ---

Deno.test("limitWeight - applies learning rate to difference", () => {
  const config = makeConfig({ learningRate: 0.1 });
  // targetWeight=1.5, currentWeight=0.5, diff=0.1*1.0=0.1 => 0.5+0.1=0.6
  const result = limitWeight(1.5, 0.5, config);
  assertAlmostEquals(result, 0.6, 1e-10);
});

Deno.test("limitWeight - returns 0 for tiny target weight", () => {
  const config = makeConfig({ plankConstant: 1e-7 });
  const result = limitWeight(1e-8, 0, config);
  assertEquals(result, 0);
});

Deno.test("limitWeight - returns currentWeight when difference is tiny", () => {
  const config = makeConfig({ plankConstant: 1e-7 });
  const result = limitWeight(0.5 + 1e-8, 0.5, config);
  assertEquals(result, 0.5);
});

Deno.test("limitWeight - throws on non-finite targetWeight", () => {
  const config = makeConfig();
  assertThrows(() => limitWeight(NaN, 0.5, config));
  assertThrows(() => limitWeight(Infinity, 0.5, config));
});

Deno.test("limitWeight - throws on non-finite currentWeight", () => {
  const config = makeConfig();
  assertThrows(() => limitWeight(0.5, NaN, config));
});

Deno.test("limitWeight - clamps large adjustment", () => {
  const config = makeConfig({
    learningRate: 1,
    maximumWeightAdjustmentScale: 2,
  });
  const result = limitWeight(100, 0, config);
  assertAlmostEquals(result, 2, 1e-10);
});

Deno.test("limitWeight - enforces limitWeightScale", () => {
  const config = makeConfig({
    learningRate: 1,
    maximumWeightAdjustmentScale: 100_000,
    limitWeightScale: 5,
  });
  const result = limitWeight(50, 0, config);
  assertEquals(Math.abs(result), 5);
});

Deno.test("limitWeight - negative direction", () => {
  const config = makeConfig({ learningRate: 0.5 });
  // targetWeight=-2, currentWeight=0, diff=0.5*(-2)=-1 => 0+(-1)=-1
  const result = limitWeight(-2, 0, config);
  assertAlmostEquals(result, -1, 1e-10);
});

// --- calculateWeight ---

Deno.test("calculateWeight - returns original weight when disableWeightAdjustment is true", () => {
  const config = createBackPropagationConfig({
    disableWeightAdjustment: true,
    generations: 0,
    learningRate: 1,
  });
  const cs = new SynapseState();
  const synapse = fakeSynapse(0.5);

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
  assertGreater(result, 1.0, "Should shift toward target");
  assertLess(result, 2.0, "Should not overshoot target");
});
