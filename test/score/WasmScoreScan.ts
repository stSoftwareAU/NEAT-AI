/**
 * Tests for WASM batch score computation (Issue #1521).
 *
 * Verifies that the WASM score scan functions produce results consistent
 * with the TypeScript implementations.
 */

import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { calculate } from "@architecture/Score.ts";
import {
  wasmComputeScoreComponents,
  wasmScanMaxBias,
  wasmScanMaxWeight,
} from "../../src/wasm/WasmStandaloneFunctions.ts";
import { ensureWasmActivation } from "../../src/wasm/EnsureWasmActivation.ts";
import { IDENTITY } from "@methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "@methods/activations/types/LOGISTIC.ts";
import { TANH } from "@methods/activations/types/TANH.ts";

Deno.test("WasmScoreScan - compute_score_components available", async () => {
  await ensureWasmActivation();

  const weights = new Float64Array([1.0, -2.0, 3.0, -4.0]);
  const biases = new Float64Array([0.5, -1.5]);

  const result = wasmComputeScoreComponents(weights, biases);
  assert(
    result !== undefined,
    "WASM compute_score_components should be available",
  );

  // total = |1| + |2| + |3| + |4| + |0.5| + |1.5| = 12.0
  assertAlmostEquals(result.totalWeightBias, 12.0, 1e-10);
  assertEquals(result.countWeightBias, 6);
  assertAlmostEquals(result.maxWeightBias, 4.0, 1e-10);
  assertAlmostEquals(result.secondMaxWeightBias, 3.0, 1e-10);
});

Deno.test("WasmScoreScan - compute_score_components empty arrays", async () => {
  await ensureWasmActivation();

  const weights = new Float64Array([]);
  const biases = new Float64Array([2.0]);

  const result = wasmComputeScoreComponents(weights, biases);
  assert(result !== undefined);

  assertAlmostEquals(result.totalWeightBias, 2.0, 1e-10);
  assertEquals(result.countWeightBias, 1);
  assertAlmostEquals(result.maxWeightBias, 2.0, 1e-10);
});

Deno.test("WasmScoreScan - scan_max_weight basic", async () => {
  await ensureWasmActivation();

  const weights = new Float64Array([1.0, -5.0, 3.0, -2.0]);
  const biases = new Float64Array([0.5, -1.0]);

  // Exclude index 1 (weight -5.0), replace with 0.1
  const result = wasmScanMaxWeight(weights, biases, 1, 0.1);
  assert(result !== undefined, "WASM scan_max_weight should be available");

  // Remaining: |1|=1, |3|=3, |2|=2, new |0.1|=0.1, biases |0.5|=0.5, |1|=1
  // max = 3, secondMax = 2
  assertAlmostEquals(result.max, 3.0, 1e-10);
  assertAlmostEquals(result.secondMax, 2.0, 1e-10);
});

Deno.test("WasmScoreScan - scan_max_bias basic", async () => {
  await ensureWasmActivation();

  const weights = new Float64Array([1.0, -2.0]);
  const biases = new Float64Array([0.5, -7.0, 3.0]);

  // Exclude bias index 1 (-7.0), replace with 0.2
  const result = wasmScanMaxBias(weights, biases, 1, 0.2);
  assert(result !== undefined, "WASM scan_max_bias should be available");

  // Weights: |1|=1, |2|=2, remaining biases: |0.5|=0.5, |3|=3, new |0.2|=0.2
  // max = 3, secondMax = 2
  assertAlmostEquals(result.max, 3.0, 1e-10);
  assertAlmostEquals(result.secondMax, 2.0, 1e-10);
});

Deno.test("WasmScoreScan - score calculation with WASM produces finite results", async () => {
  await ensureWasmActivation();

  const creature = new Creature(3, 1, {
    layers: [
      { count: 10, squash: IDENTITY.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });

  const score = calculate(creature, 0.1, 0.0001);
  assert(Number.isFinite(score), `Score should be finite, got ${score}`);
  assert(score <= 1, `Score should be <= 1, got ${score}`);
});

Deno.test("WasmScoreScan - score consistent across cache invalidations", async () => {
  await ensureWasmActivation();

  const creature = new Creature(5, 2, {
    layers: [
      { count: 20, squash: LOGISTIC.NAME },
      { count: 10, squash: TANH.NAME },
    ],
    outputLayer: { squash: IDENTITY.NAME },
  });

  const error = 0.15;
  const growthCost = 0.0001;

  // First calculation populates cache
  const score1 = calculate(creature, error, growthCost);

  // Second calculation uses cache
  const score2 = calculate(creature, error, growthCost);
  assertEquals(score1, score2, "Cached score should match initial score");

  // Invalidate and recalculate
  creature.invalidateScoreCache();
  const score3 = calculate(creature, error, growthCost);

  // Scores should be equal (same creature, same params)
  assertEquals(score1, score3, "Score after cache invalidation should match");
});

Deno.test("WasmScoreScan - larger creature score is finite", async () => {
  await ensureWasmActivation();

  const creature = new Creature(20, 5, {
    layers: [
      { count: 50, squash: IDENTITY.NAME },
      { count: 30, squash: LOGISTIC.NAME },
    ],
    outputLayer: { squash: TANH.NAME },
  });

  const score = calculate(creature, 0.05, 0.0001);
  assert(Number.isFinite(score), `Score should be finite for larger creature`);
});

Deno.test("WasmScoreScan - compute_score_components with many elements", async () => {
  await ensureWasmActivation();

  // Test with many elements
  const weights = new Float64Array(100);
  const biases = new Float64Array(50);

  // Fill with known values
  for (let i = 0; i < 100; i++) {
    weights[i] = (i + 1) * 0.1;
  }
  for (let i = 0; i < 50; i++) {
    biases[i] = -(i + 1) * 0.2;
  }

  const result = wasmComputeScoreComponents(weights, biases);
  assert(result !== undefined);

  assertEquals(result.countWeightBias, 150);

  // max should be max(10.0, 10.0) = 10.0
  assertAlmostEquals(result.maxWeightBias, 10.0, 1e-10);

  // total: weights sum = 0.1 * (1+2+...+100) = 0.1 * 5050 = 505.0
  // biases sum = 0.2 * (1+2+...+50) = 0.2 * 1275 = 255.0
  // grand total = 760.0
  assertAlmostEquals(result.totalWeightBias, 760.0, 1e-6);
});
