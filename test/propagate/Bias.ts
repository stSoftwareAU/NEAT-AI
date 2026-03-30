/**
 * Consolidated tests for Bias — verifying accumulateBias direction and
 * magnitude, and batch accumulation functions.
 *
 * Issue #1953: limitBias tests removed — TS fallback eliminated, WASM is mandatory.
 *
 * Merged from Bias.ts and BiasCalculation.ts as part of Issue #1766
 * (propagation module test audit).
 */
import {
  assertAlmostEquals,
  assertEquals,
  assertGreater,
  assertLess,
} from "@std/assert";
import { NeuronState } from "@architecture/CreatureState.ts";
import { accumulateBias } from "@propagate/Bias.ts";
import {
  type BackPropagationConfig,
  createBackPropagationConfig,
} from "@propagate/BackPropagation.ts";

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

// Issue #1953: limitBias tests removed — TS fallback eliminated, WASM is mandatory.
// The limit/regularisation logic is now tested via Rust unit tests in accumulate.rs.
