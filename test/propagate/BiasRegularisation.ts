/**
 * Issue #1859 - L1/L2 bias regularisation during backpropagation.
 *
 * Tests that L1 and L2 bias decay penalties are correctly applied
 * during backpropagation bias updates.
 */
import { assertAlmostEquals, assertLess } from "@std/assert";
import { limitBias } from "../../src/propagate/Bias.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

function makeConfig(
  overrides?: Record<string, unknown>,
) {
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
// L2 bias regularisation (bias decay)
// ---------------------------------------------------------------------------

Deno.test("L2 bias decay reduces positive bias magnitude", () => {
  const config = makeConfig({
    learningRate: 1,
    l2BiasDecay: 0.1,
  });
  const currentBias = 5.0;
  const result = limitBias(currentBias, currentBias, config);
  assertLess(Math.abs(result), Math.abs(currentBias));
});

Deno.test("L2 bias decay reduces negative bias magnitude", () => {
  const config = makeConfig({
    learningRate: 1,
    l2BiasDecay: 0.1,
  });
  const currentBias = -5.0;
  const result = limitBias(currentBias, currentBias, config);
  assertLess(Math.abs(result), Math.abs(currentBias));
});

Deno.test("L2 bias decay is zero when l2BiasDecay is 0", () => {
  const config = makeConfig({
    learningRate: 1,
    l2BiasDecay: 0,
  });
  const currentBias = 5.0;
  const result = limitBias(currentBias, currentBias, config);
  assertAlmostEquals(result, currentBias, 1e-9);
});

// ---------------------------------------------------------------------------
// L1 bias regularisation (sparsity)
// ---------------------------------------------------------------------------

Deno.test("L1 bias decay drives small positive biases toward zero", () => {
  const config = makeConfig({
    learningRate: 1,
    l1BiasDecay: 0.1,
  });
  const currentBias = 0.05;
  const result = limitBias(currentBias, currentBias, config);
  assertLess(Math.abs(result), Math.abs(currentBias));
});

Deno.test("L1 bias decay snaps to zero when penalty exceeds bias", () => {
  const config = makeConfig({
    learningRate: 1,
    l1BiasDecay: 0.5,
  });
  const currentBias = 0.01;
  const result = limitBias(currentBias, currentBias, config);
  assertAlmostEquals(result, 0, 1e-9);
});

Deno.test("L1 bias decay is zero when l1BiasDecay is 0", () => {
  const config = makeConfig({
    learningRate: 1,
    l1BiasDecay: 0,
  });
  const currentBias = 5.0;
  const result = limitBias(currentBias, currentBias, config);
  assertAlmostEquals(result, currentBias, 1e-9);
});

// ---------------------------------------------------------------------------
// Combined L1 + L2 for bias
// ---------------------------------------------------------------------------

Deno.test("Elastic net bias decay combines L1 and L2 penalties", () => {
  const l2Only = makeConfig({
    learningRate: 1,
    l1BiasDecay: 0,
    l2BiasDecay: 0.1,
  });
  const l1Only = makeConfig({
    learningRate: 1,
    l1BiasDecay: 0.1,
    l2BiasDecay: 0,
  });
  const elastic = makeConfig({
    learningRate: 1,
    l1BiasDecay: 0.1,
    l2BiasDecay: 0.1,
  });

  const currentBias = 5.0;
  const l2Result = limitBias(currentBias, currentBias, l2Only);
  const l1Result = limitBias(currentBias, currentBias, l1Only);
  const elasticResult = limitBias(currentBias, currentBias, elastic);

  assertLess(Math.abs(elasticResult), Math.abs(l2Result));
  assertLess(Math.abs(elasticResult), Math.abs(l1Result));
});

// ---------------------------------------------------------------------------
// Defaults (disabled)
// ---------------------------------------------------------------------------

Deno.test("L1/L2 bias decay defaults to 0 (disabled)", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    learningRateStrategy: "fixed",
  });
  const currentBias = 5.0;
  const result = limitBias(currentBias, currentBias, config);
  assertAlmostEquals(result, currentBias, 1e-9);
});
