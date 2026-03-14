/**
 * Consolidated tests for Bias — verifying accumulateBias direction and
 * magnitude, limitBias boundary conditions and clamping, and batch
 * accumulation functions.
 *
 * Merged from Bias.ts and BiasCalculation.ts as part of Issue #1766
 * (propagation module test audit).
 */
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
  assertThrows,
} from "@std/assert";
import { NeuronState } from "../../src/architecture/CreatureState.ts";
import { accumulateBias, limitBias } from "../../src/propagate/Bias.ts";
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

// ---------------------------------------------------------------------------
// accumulateBias - direction and magnitude
// ---------------------------------------------------------------------------

Deno.test("accumulateBias - positive delta increases totalBias", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  // targetPreActivation=5, preActivation=2 => delta=3, targetBias=0+3=3
  accumulateBias(ns, 5, 2, 0, config);

  assertEquals(ns.count, 1);
  assertGreater(ns.totalBias, 0, "Positive delta should increase totalBias");
});

Deno.test("accumulateBias - negative delta decreases totalBias", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  accumulateBias(ns, 1, 4, 0, config);

  assertEquals(ns.count, 1);
  assertLess(ns.totalBias, 0, "Negative delta should decrease totalBias");
});

Deno.test("accumulateBias - accumulates bias delta correctly", () => {
  const ns = new NeuronState();
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
  const ns = new NeuronState();
  const config = makeConfig();

  accumulateBias(ns, 2.0, 1.0, 0.5, config); // delta=1.0, target=1.5
  accumulateBias(ns, 3.0, 2.0, 0.5, config); // delta=1.0, target=1.5

  assertEquals(ns.count, 2);
  assertAlmostEquals(ns.totalBias, 3.0, 1e-10);
  assertAlmostEquals(ns.totalAdjustedBias, 3.0, 1e-10);
});

Deno.test("accumulateBias - zero delta still accumulates with currentBias", () => {
  const ns = new NeuronState();
  accumulateBias(ns, 1.0, 1.0, 0.5, makeConfig());
  assertEquals(ns.count, 1);
  assertAlmostEquals(ns.totalBias, 0.5, 1e-10);
});

// ---------------------------------------------------------------------------
// accumulateBias - non-finite handling
// ---------------------------------------------------------------------------

Deno.test("accumulateBias - skips NaN target", () => {
  const ns = new NeuronState();
  accumulateBias(ns, NaN, 1.0, 0.5, makeConfig());
  assertEquals(ns.count, 0);
});

Deno.test("accumulateBias - skips Infinity target", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  accumulateBias(ns, Infinity, 1, 0, config);
  assertEquals(ns.count, 0, "Should skip Infinity targetPreActivation");
});

Deno.test("accumulateBias - skips Infinity preActivation", () => {
  const ns = new NeuronState();
  accumulateBias(ns, 1.0, Infinity, 0.5, makeConfig());
  assertEquals(ns.count, 0);
});

Deno.test("accumulateBias - skips -Infinity preActivation", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });
  accumulateBias(ns, 1, -Infinity, 0, config);
  assertEquals(ns.count, 0, "Should skip -Infinity preActivation");
});

Deno.test("accumulateBias - skips NaN currentBias", () => {
  const ns = new NeuronState();
  accumulateBias(ns, 1.0, 1.0, NaN, makeConfig());
  assertEquals(ns.count, 0);
});

// ---------------------------------------------------------------------------
// limitBias - learning rate and clamping
// ---------------------------------------------------------------------------

Deno.test("limitBias - applies learning rate to difference", () => {
  const config = makeConfig({ learningRate: 0.1 });
  // targetBias=1.5, currentBias=0.5, diff=1.0, learnt=0.5+0.1*1.0=0.6
  const result = limitBias(1.5, 0.5, config);
  assertAlmostEquals(result, 0.6, 1e-10);
});

Deno.test("limitBias - learning rate scales adjustment", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.5,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 100000,
  });
  // target=3, current=1, diff=2, scaled=0.5*2=1 => result=2
  const result = limitBias(3, 1, config);
  assertAlmostEquals(result, 2, 1e-9);
});

// ---------------------------------------------------------------------------
// limitBias - tiny values and thresholds
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// limitBias - adjustment scale clamping
// ---------------------------------------------------------------------------

Deno.test("limitBias - clamps large positive adjustment", () => {
  const config = makeConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 2,
  });
  const result = limitBias(100, 0, config);
  assertAlmostEquals(result, 2, 1e-10);
});

Deno.test("limitBias - clamps large negative adjustment", () => {
  const config = makeConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 2,
  });
  const result = limitBias(-100, 0, config);
  assertAlmostEquals(result, -2, 1e-10);
});

Deno.test("limitBias - large gradient clamped to maximumBiasAdjustmentScale", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.5,
    maximumBiasAdjustmentScale: 1,
    limitBiasScale: 10000,
  });
  const result = limitBias(1000, 0, config);
  assertAlmostEquals(result, 1, 1e-9);
});

// ---------------------------------------------------------------------------
// limitBias - limitBiasScale enforcement
// ---------------------------------------------------------------------------

Deno.test("limitBias - enforces limitBiasScale ceiling", () => {
  const config = makeConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 100_000,
    limitBiasScale: 5,
  });
  const result = limitBias(50, 0, config);
  assert(Math.abs(result) <= 5, `Expected |result| <= 5, got ${result}`);
});

Deno.test("limitBias - enforces limitBiasScale negative floor", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 5,
  });
  const result = limitBias(-10, -4, config);
  assertLess(result, -4, "Should move toward negative target");
});

// ---------------------------------------------------------------------------
// limitBias - non-finite rejection
// ---------------------------------------------------------------------------

Deno.test("limitBias - throws on non-finite targetBias", () => {
  const config = makeConfig();
  assertThrows(() => limitBias(NaN, 0.5, config));
  assertThrows(() => limitBias(Infinity, 0.5, config));
  assertThrows(() => limitBias(-Infinity, 0, config), Error, "finite");
});
