/**
 * Unit tests for Bias.ts - accumulateBias direction/magnitude, calculateBias
 * blending, limitBias boundary conditions.
 *
 * Closes #1399
 */
import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
  assertThrows,
} from "@std/assert";
import { NeuronState } from "../../src/architecture/CreatureState.ts";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { accumulateBias, limitBias } from "../../src/propagate/Bias.ts";

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

  // targetPreActivation=1, preActivation=4 => delta=-3, targetBias=0+(-3)=-3
  accumulateBias(ns, 1, 4, 0, config);

  assertEquals(ns.count, 1);
  assertLess(ns.totalBias, 0, "Negative delta should decrease totalBias");
});

Deno.test("accumulateBias - zero delta uses currentBias as targetBias", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  // targetPreActivation=3, preActivation=3 => delta=0, targetBias=1.5
  accumulateBias(ns, 3, 3, 1.5, config);

  assertEquals(ns.count, 1);
  assertAlmostEquals(ns.totalBias, 1.5, 1e-9);
});

Deno.test("accumulateBias - skips non-finite targetPreActivation", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  accumulateBias(ns, Infinity, 1, 0, config);
  assertEquals(ns.count, 0, "Should skip Infinity targetPreActivation");

  accumulateBias(ns, NaN, 1, 0, config);
  assertEquals(ns.count, 0, "Should skip NaN targetPreActivation");
});

Deno.test("accumulateBias - skips non-finite preActivation", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  accumulateBias(ns, 1, -Infinity, 0, config);
  assertEquals(ns.count, 0, "Should skip -Infinity preActivation");
});

Deno.test("accumulateBias - skips non-finite currentBias", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  accumulateBias(ns, 1, 0.5, NaN, config);
  assertEquals(ns.count, 0, "Should skip NaN currentBias");
});

Deno.test("accumulateBias - accumulates multiple samples", () => {
  const ns = new NeuronState();
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  accumulateBias(ns, 4, 2, 0, config);
  accumulateBias(ns, 6, 3, 0, config);
  accumulateBias(ns, 2, 1, 0, config);

  assertEquals(ns.count, 3);
  // targetBias values: 2, 3, 1 => totalBias = 2+3+1 = 6
  assertAlmostEquals(ns.totalBias, 6, 0.1);
});

// ---------------------------------------------------------------------------
// limitBias - boundary conditions
// ---------------------------------------------------------------------------

Deno.test("limitBias - returns 0 for tiny target bias", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    plankConstant: 0.001,
  });

  const result = limitBias(0.0001, 0, config);
  assertEquals(result, 0, "Bias below plankConstant should return 0");
});

Deno.test("limitBias - returns currentBias when difference is negligible", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
  });

  const current = 0.5;
  const target = current + 1e-11; // difference < 1e-9 threshold
  const result = limitBias(target, current, config);
  assertAlmostEquals(result, current, 1e-9);
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

Deno.test("limitBias - clamps to maximumBiasAdjustmentScale", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 0.1,
    limitBiasScale: 100000,
  });

  // target=10, current=0 => diff=10, clamped to +0.1
  const result = limitBias(10, 0, config);
  assertAlmostEquals(result, 0.1, 1e-9);
});

Deno.test("limitBias - clamps negative direction to maximumBiasAdjustmentScale", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 0.1,
    limitBiasScale: 100000,
  });

  // target=-10, current=0 => diff=-10, clamped to -0.1
  const result = limitBias(-10, 0, config);
  assertAlmostEquals(result, -0.1, 1e-9);
});

Deno.test("limitBias - throws for non-finite target bias", () => {
  const config = createBackPropagationConfig({ learningRate: 1 });

  assertThrows(() => limitBias(Infinity, 0, config), Error, "finite");
  assertThrows(() => limitBias(-Infinity, 0, config), Error, "finite");
  assertThrows(() => limitBias(NaN, 0, config), Error, "finite");
});

Deno.test("limitBias - limitBiasScale prevents exceeding ceiling", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 5,
  });

  // target=10, current=4 => adjusted would be 10, clamped by limitBiasScale
  const result = limitBias(10, 4, config);
  assertGreater(result, 4, "Should move toward target");
  // The limit logic prevents exceeding limitBiasScale boundary
});

Deno.test("limitBias - limitBiasScale prevents exceeding negative floor", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    maximumBiasAdjustmentScale: 100,
    limitBiasScale: 5,
  });

  // target=-10, current=-4 => adjusted would be -10, clamped by limitBiasScale
  const result = limitBias(-10, -4, config);
  assertLess(result, -4, "Should move toward negative target");
});

Deno.test("limitBias - large gradient handles correctly", () => {
  const config = createBackPropagationConfig({
    learningRate: 0.5,
    maximumBiasAdjustmentScale: 1,
    limitBiasScale: 10000,
  });

  // Very large target bias
  const result = limitBias(1000, 0, config);
  assertAlmostEquals(result, 1, 1e-9, "Clamped to maximumBiasAdjustmentScale");
});
