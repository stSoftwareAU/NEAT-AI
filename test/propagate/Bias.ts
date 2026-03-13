import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { NeuronState } from "../../src/architecture/CreatureState.ts";
import {
  accumulateBias,
  accumulateBiasBatch4Way,
  accumulateBiasBatch8Way,
  limitBias,
} from "../../src/propagate/Bias.ts";
import {
  type BackPropagationConfig,
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";

function makeConfig(
  overrides?: Partial<BackPropagationConfig>,
): BackPropagationConfig {
  return createBackPropagationConfig({
    disableRandomSamples: true,
    learningRate: 0.1,
    generations: 1,
    maximumBiasAdjustmentScale: 10,
    limitBiasScale: 10_000,
    plankConstant: 1e-7,
    batchSize: 1,
    learningRateStrategy: "fixed",
    ...overrides,
  });
}

function makeNeuronState(): NeuronState {
  return new NeuronState();
}

// --- accumulateBias ---

Deno.test("accumulateBias - accumulates bias delta correctly", () => {
  const ns = makeNeuronState();
  const currentBias = 0.5;
  const preActivation = 1.0;
  const targetPreActivation = 1.5;

  accumulateBias(
    ns,
    targetPreActivation,
    preActivation,
    currentBias,
    makeConfig(),
  );

  assertEquals(ns.count, 1);
  // biasDelta = 1.5 - 1.0 = 0.5, targetBias = 0.5 + 0.5 = 1.0
  assertAlmostEquals(ns.totalBias, 1.0, 1e-10);
  assertAlmostEquals(ns.totalAdjustedBias, 1.0, 1e-10);
});

Deno.test("accumulateBias - accumulates multiple samples", () => {
  const ns = makeNeuronState();
  const config = makeConfig();

  accumulateBias(ns, 2.0, 1.0, 0.5, config); // delta=1.0, target=1.5
  accumulateBias(ns, 3.0, 2.0, 0.5, config); // delta=1.0, target=1.5

  assertEquals(ns.count, 2);
  assertAlmostEquals(ns.totalBias, 3.0, 1e-10);
  assertAlmostEquals(ns.totalAdjustedBias, 3.0, 1e-10);
});

Deno.test("accumulateBias - skips NaN target", () => {
  const ns = makeNeuronState();
  accumulateBias(ns, NaN, 1.0, 0.5, makeConfig());
  assertEquals(ns.count, 0);
});

Deno.test("accumulateBias - skips Infinity preActivation", () => {
  const ns = makeNeuronState();
  accumulateBias(ns, 1.0, Infinity, 0.5, makeConfig());
  assertEquals(ns.count, 0);
});

Deno.test("accumulateBias - skips NaN currentBias", () => {
  const ns = makeNeuronState();
  accumulateBias(ns, 1.0, 1.0, NaN, makeConfig());
  assertEquals(ns.count, 0);
});

Deno.test("accumulateBias - zero delta still accumulates", () => {
  const ns = makeNeuronState();
  accumulateBias(ns, 1.0, 1.0, 0.5, makeConfig());
  assertEquals(ns.count, 1);
  // delta = 0, targetBias = 0.5
  assertAlmostEquals(ns.totalBias, 0.5, 1e-10);
});

// --- limitBias ---

Deno.test("limitBias - applies learning rate to difference", () => {
  const config = makeConfig({ learningRate: 0.1 });
  // targetBias=1.5, currentBias=0.5, diff=1.0, learnt=0.5+0.1*1.0=0.6
  const result = limitBias(1.5, 0.5, config);
  assertAlmostEquals(result, 0.6, 1e-10);
});

Deno.test("limitBias - returns 0 for tiny target bias", () => {
  const config = makeConfig({ plankConstant: 1e-7 });
  const result = limitBias(1e-8, 0, config);
  assertEquals(result, 0);
});

Deno.test("limitBias - returns currentBias when difference is tiny", () => {
  const config = makeConfig();
  const result = limitBias(0.5 + 1e-10, 0.5, config);
  assertEquals(result, 0.5);
});

Deno.test("limitBias - throws on non-finite targetBias", () => {
  const config = makeConfig();
  assertThrows(() => limitBias(NaN, 0.5, config));
  assertThrows(() => limitBias(Infinity, 0.5, config));
});

Deno.test("limitBias - clamps large adjustment", () => {
  const config = makeConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 2,
  });
  // targetBias=100, currentBias=0, diff=100, but clamped to ±2
  const result = limitBias(100, 0, config);
  assertAlmostEquals(result, 2, 1e-10);
});

Deno.test("limitBias - clamps negative large adjustment", () => {
  const config = makeConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 2,
  });
  const result = limitBias(-100, 0, config);
  assertAlmostEquals(result, -2, 1e-10);
});

Deno.test("limitBias - enforces limitBiasScale", () => {
  const config = makeConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 100_000,
    limitBiasScale: 5,
  });
  // targetBias=50, currentBias=0 => difference=50, limitedBias=50
  // But |50| >= limitBiasScale(5), so clamp to 5
  const result = limitBias(50, 0, config);
  assert(Math.abs(result) <= 5, `Expected |result| <= 5, got ${result}`);
});

// --- accumulateBiasBatch4Way ---

Deno.test("accumulateBiasBatch4Way - accumulates 4 neurons", () => {
  const nsArray = [
    makeNeuronState(),
    makeNeuronState(),
    makeNeuronState(),
    makeNeuronState(),
  ];
  const targets = [2.0, 3.0, 4.0, 5.0];
  const preActs = [1.0, 1.0, 1.0, 1.0];
  const biases = [0.0, 0.0, 0.0, 0.0];

  accumulateBiasBatch4Way(nsArray, targets, preActs, biases, makeConfig());

  for (let i = 0; i < 4; i++) {
    assertEquals(nsArray[i].count, 1);
    // delta = targets[i] - preActs[i], targetBias = biases[i] + delta
    assertAlmostEquals(
      nsArray[i].totalBias,
      targets[i] - preActs[i],
      1e-10,
    );
  }
});

Deno.test("accumulateBiasBatch4Way - skips non-finite values per element", () => {
  const nsArray = [
    makeNeuronState(),
    makeNeuronState(),
    makeNeuronState(),
    makeNeuronState(),
  ];
  const targets = [2.0, NaN, 4.0, 5.0];
  const preActs = [1.0, 1.0, Infinity, 1.0];
  const biases = [0.0, 0.0, 0.0, NaN];

  accumulateBiasBatch4Way(nsArray, targets, preActs, biases, makeConfig());

  assertEquals(nsArray[0].count, 1); // valid
  assertEquals(nsArray[1].count, 0); // NaN target
  assertEquals(nsArray[2].count, 0); // Infinity preActivation
  assertEquals(nsArray[3].count, 0); // NaN bias
});

// --- accumulateBiasBatch8Way ---

Deno.test("accumulateBiasBatch8Way - accumulates 8 neurons", () => {
  const nsArray = Array.from({ length: 8 }, () => makeNeuronState());
  const targets = [1, 2, 3, 4, 5, 6, 7, 8];
  const preActs = [0, 0, 0, 0, 0, 0, 0, 0];
  const biases = [0, 0, 0, 0, 0, 0, 0, 0];

  accumulateBiasBatch8Way(nsArray, targets, preActs, biases, makeConfig());

  for (let i = 0; i < 8; i++) {
    assertEquals(nsArray[i].count, 1);
    assertAlmostEquals(nsArray[i].totalBias, targets[i], 1e-10);
  }
});

Deno.test("accumulateBiasBatch8Way - skips non-finite values selectively", () => {
  const nsArray = Array.from({ length: 8 }, () => makeNeuronState());
  const targets = [1, NaN, 3, 4, 5, 6, 7, 8];
  const preActs = [0, 0, 0, 0, 0, 0, 0, 0];
  const biases = [0, 0, 0, 0, 0, 0, 0, 0];

  accumulateBiasBatch8Way(nsArray, targets, preActs, biases, makeConfig());

  assertEquals(nsArray[0].count, 1);
  assertEquals(nsArray[1].count, 0); // skipped due to NaN
  assertEquals(nsArray[2].count, 1);
});
