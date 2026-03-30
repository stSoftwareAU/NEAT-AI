/**
 * Issue #1760 - Tests for generic batch bias accumulation parameterised by batch size.
 *
 * Verifies that accumulateBiasBatchNWay produces the same results as
 * calling accumulateBias individually for various batch sizes.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { NeuronState } from "@architecture/CreatureState.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import {
  accumulateBias,
  accumulateBiasBatch4Way,
  accumulateBiasBatch8Way,
  accumulateBiasBatchNWay,
} from "@propagate/Bias.ts";

/**
 * Test that accumulateBiasBatchNWay with batchSize=4 matches accumulateBiasBatch4Way.
 */
Deno.test("accumulateBiasBatchNWay - batchSize=4 matches accumulateBiasBatch4Way", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.5, -0.3, 1.2, 0.0];
  const targetPreActivationValues = [2.0, -1.5, 0.8, 3.0];
  const preActivationValues = [1.0, -0.5, 0.2, 2.5];

  const nWayStates = Array.from({ length: 4 }, () => new NeuronState());
  const fourWayStates = Array.from({ length: 4 }, () => new NeuronState());

  accumulateBiasBatchNWay(
    nWayStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
    4,
  );

  accumulateBiasBatch4Way(
    fourWayStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  for (let i = 0; i < 4; i++) {
    assertEquals(nWayStates[i].count, fourWayStates[i].count);
    assertAlmostEquals(
      nWayStates[i].totalBias,
      fourWayStates[i].totalBias,
      1e-10,
    );
    assertAlmostEquals(
      nWayStates[i].totalAdjustedBias,
      fourWayStates[i].totalAdjustedBias,
      1e-10,
    );
  }
});

/**
 * Test that accumulateBiasBatchNWay with batchSize=8 matches accumulateBiasBatch8Way.
 */
Deno.test("accumulateBiasBatchNWay - batchSize=8 matches accumulateBiasBatch8Way", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8, -0.5, 1.5];
  const targetPreActivationValues = [
    2.0,
    -1.5,
    0.8,
    3.0,
    -2.0,
    1.0,
    -0.5,
    2.5,
  ];
  const preActivationValues = [1.0, -0.5, 0.2, 2.5, -1.5, 0.5, 0.1, 1.0];

  const nWayStates = Array.from({ length: 8 }, () => new NeuronState());
  const eightWayStates = Array.from({ length: 8 }, () => new NeuronState());

  accumulateBiasBatchNWay(
    nWayStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
    8,
  );

  accumulateBiasBatch8Way(
    eightWayStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  for (let i = 0; i < 8; i++) {
    assertEquals(nWayStates[i].count, eightWayStates[i].count);
    assertAlmostEquals(
      nWayStates[i].totalBias,
      eightWayStates[i].totalBias,
      1e-10,
    );
    assertAlmostEquals(
      nWayStates[i].totalAdjustedBias,
      eightWayStates[i].totalAdjustedBias,
      1e-10,
    );
  }
});

/**
 * Test accumulateBiasBatchNWay with batchSize=1 matches a single accumulateBias call.
 */
Deno.test("accumulateBiasBatchNWay - batchSize=1 matches single accumulateBias call", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const singleState = new NeuronState();
  const batchState = new NeuronState();

  accumulateBias(singleState, 2.0, 1.0, 0.5, config);

  accumulateBiasBatchNWay(
    [batchState],
    [2.0],
    [1.0],
    [0.5],
    config,
    1,
  );

  assertEquals(batchState.count, singleState.count);
  assertAlmostEquals(batchState.totalBias, singleState.totalBias, 1e-10);
  assertAlmostEquals(
    batchState.totalAdjustedBias,
    singleState.totalAdjustedBias,
    1e-10,
  );
});

/**
 * Test accumulateBiasBatchNWay with batchSize=6 (non-standard size)
 * matches individual accumulateBias calls.
 */
Deno.test("accumulateBiasBatchNWay - batchSize=6 matches individual accumulateBias calls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const batchSize = 6;
  const currentBiases = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8];
  const targetPreActivationValues = [2.0, -1.5, 0.8, 3.0, -2.0, 1.0];
  const preActivationValues = [1.0, -0.5, 0.2, 2.5, -1.5, 0.5];

  const singleStates = Array.from(
    { length: batchSize },
    () => new NeuronState(),
  );
  const batchStates = Array.from(
    { length: batchSize },
    () => new NeuronState(),
  );

  for (let i = 0; i < batchSize; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  accumulateBiasBatchNWay(
    batchStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
    batchSize,
  );

  for (let i = 0; i < batchSize; i++) {
    assertEquals(
      batchStates[i].count,
      singleStates[i].count,
      `Neuron ${i}: count mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalBias,
      singleStates[i].totalBias,
      1e-10,
      `Neuron ${i}: totalBias mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-10,
      `Neuron ${i}: totalAdjustedBias mismatch`,
    );
  }
});

/**
 * Test accumulateBiasBatchNWay with non-finite values skips correctly.
 */
Deno.test("accumulateBiasBatchNWay - skips non-finite values correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.5, Infinity, 0.5, NaN];
  const targetPreActivationValues = [2.0, 1.0, NaN, 1.0];
  const preActivationValues = [1.0, 1.0, 1.0, 1.0];

  const states = Array.from({ length: 4 }, () => new NeuronState());

  accumulateBiasBatchNWay(
    states,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
    4,
  );

  // Only neuron 0 should have been accumulated (others have non-finite inputs)
  assertEquals(states[0].count, 1);
  assertEquals(states[1].count, 0);
  assertEquals(states[2].count, 0);
  assertEquals(states[3].count, 0);
});

/**
 * Test accumulateBiasBatchNWay with multiple iterations accumulates correctly.
 */
Deno.test("accumulateBiasBatchNWay - multiple iterations with batchSize=3 accumulate correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const batchSize = 3;
  const singleStates = Array.from(
    { length: batchSize },
    () => new NeuronState(),
  );
  const batchStates = Array.from(
    { length: batchSize },
    () => new NeuronState(),
  );

  const iterations = 10;
  for (let iter = 0; iter < iterations; iter++) {
    const currentBiases = [0.5, -0.3, 1.2];
    const targetPreActivationValues = [
      Math.sin(iter),
      Math.cos(iter),
      Math.sin(iter * 2),
    ];
    const preActivationValues = [
      Math.cos(iter) * 0.5,
      Math.sin(iter) * 0.5,
      Math.cos(iter * 2) * 0.5,
    ];

    for (let i = 0; i < batchSize; i++) {
      accumulateBias(
        singleStates[i],
        targetPreActivationValues[i],
        preActivationValues[i],
        currentBiases[i],
        config,
      );
    }

    accumulateBiasBatchNWay(
      batchStates,
      targetPreActivationValues,
      preActivationValues,
      currentBiases,
      config,
      batchSize,
    );
  }

  for (let i = 0; i < batchSize; i++) {
    assertEquals(
      batchStates[i].count,
      singleStates[i].count,
      `Neuron ${i}: count mismatch after ${iterations} iterations`,
    );
    assertAlmostEquals(
      batchStates[i].totalBias,
      singleStates[i].totalBias,
      1e-5,
      `Neuron ${i}: totalBias mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-5,
      `Neuron ${i}: totalAdjustedBias mismatch`,
    );
  }
});
