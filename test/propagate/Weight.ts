import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  accumulateWeight,
  accumulateWeightBatch4Way,
  accumulateWeightBatch8Way,
  limitWeight,
} from "../../src/propagate/Weight.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";

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

// --- accumulateWeightBatch4Way ---

Deno.test("accumulateWeightBatch4Way - accumulates 4 synapses", () => {
  const csArray = Array.from({ length: 4 }, () => new SynapseState());
  const weights = [0.5, 0.5, 0.5, 0.5];
  const targets = [1.0, 2.0, 3.0, 4.0];
  const activations = [1.0, 2.0, 3.0, 4.0];

  accumulateWeightBatch4Way(
    weights,
    csArray,
    targets,
    activations,
    makeConfig(),
  );

  for (let i = 0; i < 4; i++) {
    assertEquals(csArray[i].count, 1);
    assertEquals(csArray[i].countPositiveActivations, 1);
  }
});

Deno.test("accumulateWeightBatch4Way - skips non-finite values per element", () => {
  const csArray = Array.from({ length: 4 }, () => new SynapseState());
  const weights = [0.5, NaN, 0.5, 0.5];
  const targets = [1.0, 2.0, Infinity, 4.0];
  const activations = [1.0, 2.0, 3.0, NaN];

  accumulateWeightBatch4Way(
    weights,
    csArray,
    targets,
    activations,
    makeConfig(),
  );

  assertEquals(csArray[0].count, 1); // valid
  assertEquals(csArray[1].count, 0); // NaN weight
  assertEquals(csArray[2].count, 0); // Infinity target
  assertEquals(csArray[3].count, 0); // NaN activation
});

Deno.test("accumulateWeightBatch4Way - negative activations tracked separately", () => {
  const csArray = Array.from({ length: 4 }, () => new SynapseState());
  const weights = [0.5, 0.5, 0.5, 0.5];
  const targets = [1.0, 1.0, 1.0, 1.0];
  const activations = [2.0, -2.0, 3.0, -3.0];

  accumulateWeightBatch4Way(
    weights,
    csArray,
    targets,
    activations,
    makeConfig(),
  );

  assertEquals(csArray[0].countPositiveActivations, 1);
  assertEquals(csArray[0].countNegativeActivations, 0);
  assertEquals(csArray[1].countPositiveActivations, 0);
  assertEquals(csArray[1].countNegativeActivations, 1);
});

// --- accumulateWeightBatch8Way ---

Deno.test("accumulateWeightBatch8Way - accumulates 8 synapses", () => {
  const csArray = Array.from({ length: 8 }, () => new SynapseState());
  const weights = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const targets = [1, 2, 3, 4, 5, 6, 7, 8];
  const activations = [1, 1, 1, 1, 1, 1, 1, 1];

  accumulateWeightBatch8Way(
    weights,
    csArray,
    targets,
    activations,
    makeConfig(),
  );

  for (let i = 0; i < 8; i++) {
    assertEquals(csArray[i].count, 1);
  }
});

Deno.test("accumulateWeightBatch8Way - skips non-finite values selectively", () => {
  const csArray = Array.from({ length: 8 }, () => new SynapseState());
  const weights = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const targets = [1, NaN, 3, 4, 5, 6, 7, 8];
  const activations = [1, 1, 1, 1, 1, 1, 1, 1];

  accumulateWeightBatch8Way(
    weights,
    csArray,
    targets,
    activations,
    makeConfig(),
  );

  assertEquals(csArray[0].count, 1);
  assertEquals(csArray[1].count, 0); // NaN target skipped
  assertEquals(csArray[2].count, 1);
});
