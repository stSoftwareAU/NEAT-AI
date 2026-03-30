/**
 * Issue #1760 - Tests for generic batch weight accumulation parameterised by batch size.
 *
 * Verifies that accumulateWeightBatchNWay produces the same results as
 * calling accumulateWeight individually for various batch sizes.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SynapseState } from "@propagate/SynapseState.ts";
import {
  accumulateWeight,
  accumulateWeightBatch4Way,
  accumulateWeightBatch8Way,
  accumulateWeightBatchNWay,
} from "@propagate/Weight.ts";

/**
 * Test that accumulateWeightBatchNWay with batchSize=4 matches accumulateWeightBatch4Way.
 */
Deno.test("accumulateWeightBatchNWay - batchSize=4 matches accumulateWeightBatch4Way", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_000_1,
  });

  const currentWeights = [0.5, -0.3, 1.2, 0.0];
  const targetValues = [2.0, -1.5, 0.8, 3.0];
  const activations = [1.0, 0.5, -0.8, 2.0];

  const nWayStates = Array.from({ length: 4 }, () => new SynapseState());
  const fourWayStates = Array.from({ length: 4 }, () => new SynapseState());

  accumulateWeightBatchNWay(
    currentWeights,
    nWayStates,
    targetValues,
    activations,
    config,
    4,
  );

  accumulateWeightBatch4Way(
    currentWeights,
    fourWayStates,
    targetValues,
    activations,
    config,
  );

  for (let i = 0; i < 4; i++) {
    assertEquals(nWayStates[i].count, fourWayStates[i].count);
    assertAlmostEquals(
      nWayStates[i].totalPositiveActivation,
      fourWayStates[i].totalPositiveActivation,
      1e-10,
    );
    assertAlmostEquals(
      nWayStates[i].totalNegativeActivation,
      fourWayStates[i].totalNegativeActivation,
      1e-10,
    );
    assertAlmostEquals(
      nWayStates[i].totalPositiveAdjustedValue,
      fourWayStates[i].totalPositiveAdjustedValue,
      1e-10,
    );
    assertAlmostEquals(
      nWayStates[i].totalNegativeAdjustedValue,
      fourWayStates[i].totalNegativeAdjustedValue,
      1e-10,
    );
    assertEquals(
      nWayStates[i].countPositiveActivations,
      fourWayStates[i].countPositiveActivations,
    );
    assertEquals(
      nWayStates[i].countNegativeActivations,
      fourWayStates[i].countNegativeActivations,
    );
  }
});

/**
 * Test that accumulateWeightBatchNWay with batchSize=8 matches accumulateWeightBatch8Way.
 */
Deno.test("accumulateWeightBatchNWay - batchSize=8 matches accumulateWeightBatch8Way", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_000_1,
  });

  const currentWeights = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8, -0.5, 1.5];
  const targetValues = [2.0, -1.5, 0.8, 3.0, -2.0, 1.0, -0.5, 2.5];
  const activations = [1.0, 0.5, -0.8, 2.0, -1.5, 0.3, 0.9, -0.6];

  const nWayStates = Array.from({ length: 8 }, () => new SynapseState());
  const eightWayStates = Array.from({ length: 8 }, () => new SynapseState());

  accumulateWeightBatchNWay(
    currentWeights,
    nWayStates,
    targetValues,
    activations,
    config,
    8,
  );

  accumulateWeightBatch8Way(
    currentWeights,
    eightWayStates,
    targetValues,
    activations,
    config,
  );

  for (let i = 0; i < 8; i++) {
    assertEquals(nWayStates[i].count, eightWayStates[i].count);
    assertAlmostEquals(
      nWayStates[i].totalPositiveActivation,
      eightWayStates[i].totalPositiveActivation,
      1e-10,
    );
    assertAlmostEquals(
      nWayStates[i].totalNegativeActivation,
      eightWayStates[i].totalNegativeActivation,
      1e-10,
    );
    assertAlmostEquals(
      nWayStates[i].totalPositiveAdjustedValue,
      eightWayStates[i].totalPositiveAdjustedValue,
      1e-10,
    );
    assertAlmostEquals(
      nWayStates[i].totalNegativeAdjustedValue,
      eightWayStates[i].totalNegativeAdjustedValue,
      1e-10,
    );
  }
});

/**
 * Test accumulateWeightBatchNWay with batchSize=1 matches a single accumulateWeight call.
 */
Deno.test("accumulateWeightBatchNWay - batchSize=1 matches single accumulateWeight call", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_000_1,
  });

  const singleState = new SynapseState();
  const batchState = new SynapseState();

  accumulateWeight(0.5, singleState, 2.0, 1.0, config);

  accumulateWeightBatchNWay(
    [0.5],
    [batchState],
    [2.0],
    [1.0],
    config,
    1,
  );

  assertEquals(batchState.count, singleState.count);
  assertAlmostEquals(
    batchState.totalPositiveActivation,
    singleState.totalPositiveActivation,
    1e-10,
  );
  assertAlmostEquals(
    batchState.totalPositiveAdjustedValue,
    singleState.totalPositiveAdjustedValue,
    1e-10,
  );
  assertEquals(
    batchState.countPositiveActivations,
    singleState.countPositiveActivations,
  );
});

/**
 * Test accumulateWeightBatchNWay with batchSize=6 (non-standard size)
 * matches individual accumulateWeight calls.
 */
Deno.test("accumulateWeightBatchNWay - batchSize=6 matches individual accumulateWeight calls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_000_1,
  });

  const batchSize = 6;
  const currentWeights = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8];
  const targetValues = [2.0, -1.5, 0.8, 3.0, -2.0, 1.0];
  const activations = [1.0, 0.5, -0.8, 2.0, -1.5, 0.3];

  const singleStates = Array.from(
    { length: batchSize },
    () => new SynapseState(),
  );
  const batchStates = Array.from(
    { length: batchSize },
    () => new SynapseState(),
  );

  for (let i = 0; i < batchSize; i++) {
    accumulateWeight(
      currentWeights[i],
      singleStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  accumulateWeightBatchNWay(
    currentWeights,
    batchStates,
    targetValues,
    activations,
    config,
    batchSize,
  );

  for (let i = 0; i < batchSize; i++) {
    assertEquals(
      batchStates[i].count,
      singleStates[i].count,
      `Synapse ${i}: count mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-10,
      `Synapse ${i}: totalPositiveActivation mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-10,
      `Synapse ${i}: totalNegativeActivation mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveAdjustedValue,
      singleStates[i].totalPositiveAdjustedValue,
      1e-10,
      `Synapse ${i}: totalPositiveAdjustedValue mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeAdjustedValue,
      singleStates[i].totalNegativeAdjustedValue,
      1e-10,
      `Synapse ${i}: totalNegativeAdjustedValue mismatch`,
    );
    assertEquals(
      batchStates[i].countPositiveActivations,
      singleStates[i].countPositiveActivations,
      `Synapse ${i}: countPositiveActivations mismatch`,
    );
    assertEquals(
      batchStates[i].countNegativeActivations,
      singleStates[i].countNegativeActivations,
      `Synapse ${i}: countNegativeActivations mismatch`,
    );
  }
});

/**
 * Test accumulateWeightBatchNWay with non-finite values skips correctly.
 */
Deno.test("accumulateWeightBatchNWay - skips non-finite values correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentWeights = [0.5, Infinity, 0.5, NaN];
  const targetValues = [2.0, 1.0, NaN, 1.0];
  const activations = [1.0, 1.0, 1.0, 1.0];

  const states = Array.from({ length: 4 }, () => new SynapseState());

  accumulateWeightBatchNWay(
    currentWeights,
    states,
    targetValues,
    activations,
    config,
    4,
  );

  // Only synapse 0 should have been accumulated (others have non-finite inputs)
  assertEquals(states[0].count, 1);
  assertEquals(states[1].count, 0);
  assertEquals(states[2].count, 0);
  assertEquals(states[3].count, 0);
});

/**
 * Test accumulateWeightBatchNWay with multiple iterations accumulates correctly.
 */
Deno.test("accumulateWeightBatchNWay - multiple iterations with batchSize=3 accumulate correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const batchSize = 3;
  const singleStates = Array.from(
    { length: batchSize },
    () => new SynapseState(),
  );
  const batchStates = Array.from(
    { length: batchSize },
    () => new SynapseState(),
  );

  const iterations = 10;
  for (let iter = 0; iter < iterations; iter++) {
    const currentWeights = [0.5, -0.3, 1.2];
    const targetValues = [
      Math.sin(iter),
      Math.cos(iter),
      Math.sin(iter * 2),
    ];
    const activations = [
      0.5 + 0.3 * Math.sin(iter),
      -0.5 + 0.3 * Math.cos(iter),
      0.8 * Math.sin(iter * 3),
    ];

    for (let i = 0; i < batchSize; i++) {
      accumulateWeight(
        currentWeights[i],
        singleStates[i],
        targetValues[i],
        activations[i],
        config,
      );
    }

    accumulateWeightBatchNWay(
      currentWeights,
      batchStates,
      targetValues,
      activations,
      config,
      batchSize,
    );
  }

  for (let i = 0; i < batchSize; i++) {
    assertEquals(
      batchStates[i].count,
      singleStates[i].count,
      `Synapse ${i}: count mismatch after ${iterations} iterations`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-5,
      `Synapse ${i}: totalPositiveActivation mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-5,
      `Synapse ${i}: totalNegativeActivation mismatch`,
    );
  }
});
