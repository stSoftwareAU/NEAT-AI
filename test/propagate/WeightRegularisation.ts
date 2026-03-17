/**
 * Issue #1859 - L1/L2 weight regularisation during backpropagation.
 *
 * Tests that L1 and L2 weight decay penalties are correctly applied
 * during backpropagation weight updates.
 */
import { assertAlmostEquals, assertGreater, assertLess } from "@std/assert";
import { limitWeight } from "../../src/propagate/Weight.ts";
import { createBackPropagationConfig } from "../../src/propagate/BackPropagation.ts";

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
// L2 weight regularisation (weight decay)
// ---------------------------------------------------------------------------

Deno.test("L2 weight decay reduces positive weight magnitude", () => {
  const config = makeConfig({
    learningRate: 1,
    l2WeightDecay: 0.1,
  });
  // Target equals current, so no gradient update. Only L2 decay applies.
  const currentWeight = 5.0;
  const result = limitWeight(currentWeight, currentWeight, config);
  // L2 decay: w *= (1 - lr * lambda) = 5 * (1 - 1 * 0.1) = 4.5
  assertLess(Math.abs(result), Math.abs(currentWeight));
});

Deno.test("L2 weight decay reduces negative weight magnitude", () => {
  const config = makeConfig({
    learningRate: 1,
    l2WeightDecay: 0.1,
  });
  const currentWeight = -5.0;
  const result = limitWeight(currentWeight, currentWeight, config);
  // Magnitude should decrease
  assertLess(Math.abs(result), Math.abs(currentWeight));
});

Deno.test("L2 weight decay strength controls decay rate", () => {
  const weakConfig = makeConfig({
    learningRate: 1,
    l2WeightDecay: 0.01,
  });
  const strongConfig = makeConfig({
    learningRate: 1,
    l2WeightDecay: 0.5,
  });
  const currentWeight = 10.0;

  const weakResult = limitWeight(currentWeight, currentWeight, weakConfig);
  const strongResult = limitWeight(currentWeight, currentWeight, strongConfig);

  // Stronger decay should result in smaller weight
  assertLess(Math.abs(strongResult), Math.abs(weakResult));
});

Deno.test("L2 weight decay is zero when l2WeightDecay is 0", () => {
  const config = makeConfig({
    learningRate: 1,
    l2WeightDecay: 0,
  });
  const currentWeight = 5.0;
  // Target = current so no gradient. With L2=0, weight should stay the same.
  const result = limitWeight(currentWeight, currentWeight, config);
  assertAlmostEquals(result, currentWeight, 1e-9);
});

Deno.test("L2 weight decay works alongside gradient updates", () => {
  const configNoDecay = makeConfig({
    learningRate: 0.1,
    l2WeightDecay: 0,
  });
  const configWithDecay = makeConfig({
    learningRate: 0.1,
    l2WeightDecay: 0.1,
  });
  const currentWeight = 5.0;
  const targetWeight = 6.0;

  const resultNoDecay = limitWeight(targetWeight, currentWeight, configNoDecay);
  const resultWithDecay = limitWeight(
    targetWeight,
    currentWeight,
    configWithDecay,
  );

  // With L2 decay, the result should be smaller than without
  assertLess(resultWithDecay, resultNoDecay);
});

// ---------------------------------------------------------------------------
// L1 weight regularisation (sparsity)
// ---------------------------------------------------------------------------

Deno.test("L1 weight decay drives small positive weights toward zero", () => {
  const config = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0.1,
  });
  // Small positive weight with no gradient update
  const currentWeight = 0.05;
  const result = limitWeight(currentWeight, currentWeight, config);
  // L1 should push toward zero: w - lr * lambda * sign(w)
  assertLess(Math.abs(result), Math.abs(currentWeight));
});

Deno.test("L1 weight decay drives small negative weights toward zero", () => {
  const config = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0.1,
  });
  const currentWeight = -0.05;
  const result = limitWeight(currentWeight, currentWeight, config);
  assertLess(Math.abs(result), Math.abs(currentWeight));
});

Deno.test("L1 weight decay snaps to zero when penalty exceeds weight", () => {
  const config = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0.5,
  });
  // Weight is very small, L1 penalty (0.5) exceeds it
  const currentWeight = 0.01;
  const result = limitWeight(currentWeight, currentWeight, config);
  // Should snap to zero rather than crossing it
  assertAlmostEquals(result, 0, 1e-9);
});

Deno.test("L1 weight decay strength controls sparsity pressure", () => {
  const weakConfig = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0.01,
  });
  const strongConfig = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0.5,
  });
  const currentWeight = 5.0;

  const weakResult = limitWeight(currentWeight, currentWeight, weakConfig);
  const strongResult = limitWeight(currentWeight, currentWeight, strongConfig);

  // Stronger L1 should result in smaller weight
  assertLess(Math.abs(strongResult), Math.abs(weakResult));
});

Deno.test("L1 weight decay is zero when l1WeightDecay is 0", () => {
  const config = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0,
  });
  const currentWeight = 5.0;
  const result = limitWeight(currentWeight, currentWeight, config);
  assertAlmostEquals(result, currentWeight, 1e-9);
});

// ---------------------------------------------------------------------------
// Combined L1 + L2 (elastic net)
// ---------------------------------------------------------------------------

Deno.test("Elastic net combines L1 and L2 penalties", () => {
  const l2Only = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0,
    l2WeightDecay: 0.1,
  });
  const l1Only = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0.1,
    l2WeightDecay: 0,
  });
  const elastic = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0.1,
    l2WeightDecay: 0.1,
  });

  const currentWeight = 5.0;
  const l2Result = limitWeight(currentWeight, currentWeight, l2Only);
  const l1Result = limitWeight(currentWeight, currentWeight, l1Only);
  const elasticResult = limitWeight(currentWeight, currentWeight, elastic);

  // Elastic net should be more aggressive than either alone
  assertLess(Math.abs(elasticResult), Math.abs(l2Result));
  assertLess(Math.abs(elasticResult), Math.abs(l1Result));
});

// ---------------------------------------------------------------------------
// Regularisation over multiple iterations reduces weight magnitudes
// ---------------------------------------------------------------------------

Deno.test("L2 weight decay progressively reduces weights over iterations", () => {
  const config = makeConfig({
    learningRate: 1,
    l2WeightDecay: 0.1,
  });

  let weight = 10.0;
  for (let i = 0; i < 10; i++) {
    weight = limitWeight(weight, weight, config);
  }

  // After 10 iterations of decay, weight should be significantly reduced
  assertLess(Math.abs(weight), 5.0);
  assertGreater(Math.abs(weight), 0);
});

Deno.test("L1 weight decay progressively drives weights toward zero", () => {
  const config = makeConfig({
    learningRate: 1,
    l1WeightDecay: 0.1,
  });

  let weight = 1.0;
  for (let i = 0; i < 20; i++) {
    weight = limitWeight(weight, weight, config);
  }

  // After many iterations, weight should be at or very near zero
  assertAlmostEquals(weight, 0, 0.01);
});

// ---------------------------------------------------------------------------
// Integration with sparse training (sparseRatio)
// ---------------------------------------------------------------------------

Deno.test("Weight regularisation config works with sparseRatio", () => {
  // Verify that sparseRatio and regularisation can coexist in config
  const config = makeConfig({
    sparseRatio: 0.5,
    l1WeightDecay: 0.01,
    l2WeightDecay: 0.01,
  });
  const currentWeight = 5.0;
  const result = limitWeight(currentWeight, currentWeight, config);
  // Regularisation should still apply regardless of sparseRatio
  assertLess(Math.abs(result), Math.abs(currentWeight));
});

// ---------------------------------------------------------------------------
// Default values (disabled by default)
// ---------------------------------------------------------------------------

Deno.test("L1/L2 weight decay defaults to 0 (disabled)", () => {
  const config = createBackPropagationConfig({
    learningRate: 1,
    learningRateStrategy: "fixed",
  });
  const currentWeight = 5.0;
  const result = limitWeight(currentWeight, currentWeight, config);
  // With defaults (0), no decay should be applied
  assertAlmostEquals(result, currentWeight, 1e-9);
});
