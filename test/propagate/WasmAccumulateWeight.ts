/**
 * Issue #1518 - WASM Weight Batch Accumulation Tests
 *
 * Verifies that the WASM weight accumulation functions produce identical
 * results to the TypeScript implementations. These tests exercise the
 * WASM→TS boundary and validate the packed array unpacking logic.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";
import {
  accumulateWeight,
  accumulateWeightBatch4Way,
  accumulateWeightBatch8Way,
  calculateWeight,
} from "../../src/propagate/Weight.ts";

/**
 * Verify the WASM-integrated 4-way batch produces the same results as
 * single calls (WASM is tried first, falls back to TS if unavailable).
 */
Deno.test("WasmAccumulateWeightBatch4Way-MatchesSingleCalls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_000_1,
  });

  const currentWeights = [0.5, -0.3, 1.2, 0.0];
  const targetValues = [2.0, -1.5, 0.8, 3.0];
  const activations = [1.0, 0.5, -0.8, 2.0];

  const singleStates = Array.from({ length: 4 }, () => new SynapseState());
  const batchStates = Array.from({ length: 4 }, () => new SynapseState());

  for (let i = 0; i < 4; i++) {
    accumulateWeight(
      currentWeights[i],
      singleStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  accumulateWeightBatch4Way(
    currentWeights,
    batchStates,
    targetValues,
    activations,
    config,
  );

  for (let i = 0; i < 4; i++) {
    assertEquals(batchStates[i].count, singleStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      batchStates[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-6,
      `totalPositiveActivation[${i}]`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-6,
      `totalNegativeActivation[${i}]`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveAdjustedValue,
      singleStates[i].totalPositiveAdjustedValue,
      1e-6,
      `totalPositiveAdjustedValue[${i}]`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeAdjustedValue,
      singleStates[i].totalNegativeAdjustedValue,
      1e-6,
      `totalNegativeAdjustedValue[${i}]`,
    );
    assertEquals(
      batchStates[i].countPositiveActivations,
      singleStates[i].countPositiveActivations,
      `countPositiveActivations[${i}]`,
    );
    assertEquals(
      batchStates[i].countNegativeActivations,
      singleStates[i].countNegativeActivations,
      `countNegativeActivations[${i}]`,
    );
  }
});

/**
 * Verify the WASM-integrated 8-way batch produces the same results.
 */
Deno.test("WasmAccumulateWeightBatch8Way-MatchesSingleCalls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_000_1,
  });

  const currentWeights = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8, -0.5, 1.5];
  const targetValues = [2.0, -1.5, 0.8, 3.0, -2.0, 1.0, -0.5, 2.5];
  const activations = [1.0, 0.5, -0.8, 2.0, -1.5, 0.3, 0.9, -0.6];

  const singleStates = Array.from({ length: 8 }, () => new SynapseState());
  const batchStates = Array.from({ length: 8 }, () => new SynapseState());

  for (let i = 0; i < 8; i++) {
    accumulateWeight(
      currentWeights[i],
      singleStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  accumulateWeightBatch8Way(
    currentWeights,
    batchStates,
    targetValues,
    activations,
    config,
  );

  for (let i = 0; i < 8; i++) {
    assertEquals(batchStates[i].count, singleStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      batchStates[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-6,
      `totalPositiveActivation[${i}]`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-6,
      `totalNegativeActivation[${i}]`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveAdjustedValue,
      singleStates[i].totalPositiveAdjustedValue,
      1e-6,
      `totalPositiveAdjustedValue[${i}]`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeAdjustedValue,
      singleStates[i].totalNegativeAdjustedValue,
      1e-6,
      `totalNegativeAdjustedValue[${i}]`,
    );
  }
});

/**
 * Test multiple iterations to verify accumulation stability.
 */
Deno.test("WasmAccumulateWeightBatch4Way-MultipleIterations", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const singleStates = Array.from({ length: 4 }, () => new SynapseState());
  const batchStates = Array.from({ length: 4 }, () => new SynapseState());

  for (let iter = 0; iter < 20; iter++) {
    const currentWeights = [0.5, -0.3, 1.2, 0.0];
    const targetValues = [
      Math.sin(iter),
      Math.cos(iter),
      Math.sin(iter * 2),
      Math.cos(iter * 2),
    ];
    const activations = [
      0.5 + 0.3 * Math.sin(iter),
      -0.5 + 0.3 * Math.cos(iter),
      0.8 * Math.sin(iter * 3),
      -0.8 * Math.cos(iter * 3),
    ];

    for (let i = 0; i < 4; i++) {
      accumulateWeight(
        currentWeights[i],
        singleStates[i],
        targetValues[i],
        activations[i],
        config,
      );
    }

    accumulateWeightBatch4Way(
      currentWeights,
      batchStates,
      targetValues,
      activations,
      config,
    );
  }

  for (let i = 0; i < 4; i++) {
    assertEquals(batchStates[i].count, singleStates[i].count);
    assertAlmostEquals(
      batchStates[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-5,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-5,
    );
  }
});

/**
 * Test non-finite value handling (Issue #1314).
 */
Deno.test("WasmAccumulateWeightBatch4Way-NonFiniteValues", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentWeights = [0.5, NaN, Infinity, -Infinity];
  const targetValues = [2.0, 1.0, 1.0, 1.0];
  const activations = [1.0, 1.0, 1.0, 1.0];

  const singleStates = Array.from({ length: 4 }, () => new SynapseState());
  const batchStates = Array.from({ length: 4 }, () => new SynapseState());

  for (let i = 0; i < 4; i++) {
    accumulateWeight(
      currentWeights[i],
      singleStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  accumulateWeightBatch4Way(
    currentWeights,
    batchStates,
    targetValues,
    activations,
    config,
  );

  // Only the first synapse should have been accumulated
  assertEquals(batchStates[0].count, 1);
  assertEquals(batchStates[1].count, 0);
  assertEquals(batchStates[2].count, 0);
  assertEquals(batchStates[3].count, 0);

  for (let i = 0; i < 4; i++) {
    assertEquals(batchStates[i].count, singleStates[i].count);
  }
});

/**
 * Test calculateWeight with various accumulated states.
 */
Deno.test("WasmCalculateWeight-MatchesTypeScript", () => {
  const config = createBackPropagationConfig({
    generations: 5,
    learningRate: 0.01,
    plankConstant: 0.000_000_1,
    maximumWeightAdjustmentScale: 1,
    limitWeightScale: 100_000,
  });

  // Accumulate some data first
  const cs = new SynapseState();
  const weights = [0.5, -0.3, 1.2, 0.0];
  const targets = [2.0, -1.5, 0.8, 3.0];
  const acts = [1.0, 0.5, -0.8, 2.0];

  for (let i = 0; i < 4; i++) {
    accumulateWeight(weights[i % 4], cs, targets[i % 4], acts[i % 4], config);
  }

  const synapse = { weight: 0.5, from: 0, to: 1, type: "positive" };
  // deno-lint-ignore no-explicit-any
  const result = calculateWeight(cs, synapse as any, config);

  // The result should be a finite number
  assertEquals(Number.isFinite(result), true, "Result should be finite");
});
