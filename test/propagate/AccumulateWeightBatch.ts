/**
 * Issue #1214 - SIMD Batch Weight and Bias Gradient Accumulation
 *
 * Tests for batch weight accumulation functions that process 4 or 8
 * synapses simultaneously for improved performance during backpropagation.
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
} from "../../src/propagate/Weight.ts";

/**
 * Test that batch 4-way accumulation produces the same results as
 * calling accumulateWeight 4 times individually.
 */
Deno.test("AccumulateWeightBatch4Way-MatchesSingleCalls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_000_1,
  });

  // Test data: 4 synapses with different weights, activations, and target values
  const currentWeights = [0.5, -0.3, 1.2, 0.0];
  const targetValues = [2.0, -1.5, 0.8, 3.0];
  const activations = [1.0, 0.5, -0.8, 2.0];

  // Create individual SynapseStates for single-call approach
  const singleStates = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  // Create SynapseStates for batch approach
  const batchStates = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  // Single calls
  for (let i = 0; i < 4; i++) {
    accumulateWeight(
      currentWeights[i],
      singleStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  // Batch call
  accumulateWeightBatch4Way(
    currentWeights,
    batchStates,
    targetValues,
    activations,
    config,
  );

  // Verify results match
  for (let i = 0; i < 4; i++) {
    assertEquals(
      batchStates[i].count,
      singleStates[i].count,
      `Synapse ${i}: count mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-6,
      `Synapse ${i}: totalPositiveActivation mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-6,
      `Synapse ${i}: totalNegativeActivation mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveAdjustedValue,
      singleStates[i].totalPositiveAdjustedValue,
      1e-6,
      `Synapse ${i}: totalPositiveAdjustedValue mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeAdjustedValue,
      singleStates[i].totalNegativeAdjustedValue,
      1e-6,
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
 * Test batch 4-way with all positive activations.
 */
Deno.test("AccumulateWeightBatch4Way-AllPositiveActivations", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentWeights = [1.0, 1.0, 1.0, 1.0];
  const targetValues = [2.0, 3.0, 4.0, 5.0];
  const activations = [1.0, 1.0, 1.0, 1.0];

  const states = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  accumulateWeightBatch4Way(
    currentWeights,
    states,
    targetValues,
    activations,
    config,
  );

  // All activations are positive, so all should contribute to positive totals
  for (let i = 0; i < 4; i++) {
    assertEquals(states[i].count, 1, `Synapse ${i}: count should be 1`);
    assertEquals(
      states[i].countPositiveActivations,
      1,
      `Synapse ${i}: should have 1 positive activation`,
    );
    assertEquals(
      states[i].countNegativeActivations,
      0,
      `Synapse ${i}: should have 0 negative activations`,
    );
  }
});

/**
 * Test batch 4-way with all negative activations.
 */
Deno.test("AccumulateWeightBatch4Way-AllNegativeActivations", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentWeights = [1.0, 1.0, 1.0, 1.0];
  const targetValues = [-2.0, -3.0, -4.0, -5.0];
  const activations = [-1.0, -1.0, -1.0, -1.0];

  const states = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  accumulateWeightBatch4Way(
    currentWeights,
    states,
    targetValues,
    activations,
    config,
  );

  // All activations are negative, so all should contribute to negative totals
  for (let i = 0; i < 4; i++) {
    assertEquals(states[i].count, 1, `Synapse ${i}: count should be 1`);
    assertEquals(
      states[i].countPositiveActivations,
      0,
      `Synapse ${i}: should have 0 positive activations`,
    );
    assertEquals(
      states[i].countNegativeActivations,
      1,
      `Synapse ${i}: should have 1 negative activation`,
    );
  }
});

/**
 * Test batch 4-way with mixed activations.
 */
Deno.test("AccumulateWeightBatch4Way-MixedActivations", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentWeights = [0.5, 0.5, 0.5, 0.5];
  const targetValues = [1.0, -1.0, 1.0, -1.0];
  const activations = [0.5, -0.5, 0.5, -0.5]; // alternating positive/negative

  const states = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  accumulateWeightBatch4Way(
    currentWeights,
    states,
    targetValues,
    activations,
    config,
  );

  // Even indices (0, 2) have positive activations
  assertEquals(states[0].countPositiveActivations, 1);
  assertEquals(states[0].countNegativeActivations, 0);
  assertEquals(states[2].countPositiveActivations, 1);
  assertEquals(states[2].countNegativeActivations, 0);

  // Odd indices (1, 3) have negative activations
  assertEquals(states[1].countPositiveActivations, 0);
  assertEquals(states[1].countNegativeActivations, 1);
  assertEquals(states[3].countPositiveActivations, 0);
  assertEquals(states[3].countNegativeActivations, 1);
});

/**
 * Test batch 4-way called multiple times accumulates correctly.
 */
Deno.test("AccumulateWeightBatch4Way-MultipleIterations", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  // Run multiple batches and verify accumulation
  const states = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];
  const singleStates = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  const iterations = 10;
  for (let iter = 0; iter < iterations; iter++) {
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

    // Single calls
    for (let i = 0; i < 4; i++) {
      accumulateWeight(
        currentWeights[i],
        singleStates[i],
        targetValues[i],
        activations[i],
        config,
      );
    }

    // Batch call
    accumulateWeightBatch4Way(
      currentWeights,
      states,
      targetValues,
      activations,
      config,
    );
  }

  // Verify results match after all iterations
  for (let i = 0; i < 4; i++) {
    assertEquals(
      states[i].count,
      singleStates[i].count,
      `Synapse ${i}: count mismatch after ${iterations} iterations`,
    );
    assertAlmostEquals(
      states[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-5,
      `Synapse ${i}: totalPositiveActivation mismatch`,
    );
    assertAlmostEquals(
      states[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-5,
      `Synapse ${i}: totalNegativeActivation mismatch`,
    );
  }
});

/**
 * Test that batch 8-way accumulation produces the same results as
 * calling accumulateWeight 8 times individually.
 */
Deno.test("AccumulateWeightBatch8Way-MatchesSingleCalls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_000_1,
  });

  // Test data: 8 synapses with different weights, activations, and target values
  const currentWeights = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8, -0.5, 1.5];
  const targetValues = [2.0, -1.5, 0.8, 3.0, -2.0, 1.0, -0.5, 2.5];
  const activations = [1.0, 0.5, -0.8, 2.0, -1.5, 0.3, 0.9, -0.6];

  // Create individual SynapseStates for single-call approach
  const singleStates: SynapseState[] = [];
  for (let i = 0; i < 8; i++) {
    singleStates.push(new SynapseState());
  }

  // Create SynapseStates for batch approach
  const batchStates: SynapseState[] = [];
  for (let i = 0; i < 8; i++) {
    batchStates.push(new SynapseState());
  }

  // Single calls
  for (let i = 0; i < 8; i++) {
    accumulateWeight(
      currentWeights[i],
      singleStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  // Batch call
  accumulateWeightBatch8Way(
    currentWeights,
    batchStates,
    targetValues,
    activations,
    config,
  );

  // Verify results match
  for (let i = 0; i < 8; i++) {
    assertEquals(
      batchStates[i].count,
      singleStates[i].count,
      `Synapse ${i}: count mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-6,
      `Synapse ${i}: totalPositiveActivation mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-6,
      `Synapse ${i}: totalNegativeActivation mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalPositiveAdjustedValue,
      singleStates[i].totalPositiveAdjustedValue,
      1e-6,
      `Synapse ${i}: totalPositiveAdjustedValue mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalNegativeAdjustedValue,
      singleStates[i].totalNegativeAdjustedValue,
      1e-6,
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
 * Test batch 8-way with multiple iterations.
 */
Deno.test("AccumulateWeightBatch8Way-MultipleIterations", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  // Run multiple batches and verify accumulation
  const states: SynapseState[] = [];
  const singleStates: SynapseState[] = [];
  for (let i = 0; i < 8; i++) {
    states.push(new SynapseState());
    singleStates.push(new SynapseState());
  }

  const iterations = 10;
  for (let iter = 0; iter < iterations; iter++) {
    const currentWeights = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8, -0.5, 1.5];
    const targetValues: number[] = [];
    const activations: number[] = [];

    for (let i = 0; i < 8; i++) {
      targetValues.push(Math.sin(iter + i * 0.5));
      activations.push(0.5 * Math.cos(iter + i * 0.3));
    }

    // Single calls
    for (let i = 0; i < 8; i++) {
      accumulateWeight(
        currentWeights[i],
        singleStates[i],
        targetValues[i],
        activations[i],
        config,
      );
    }

    // Batch call
    accumulateWeightBatch8Way(
      currentWeights,
      states,
      targetValues,
      activations,
      config,
    );
  }

  // Verify results match after all iterations
  for (let i = 0; i < 8; i++) {
    assertEquals(
      states[i].count,
      singleStates[i].count,
      `Synapse ${i}: count mismatch after ${iterations} iterations`,
    );
    assertAlmostEquals(
      states[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-5,
      `Synapse ${i}: totalPositiveActivation mismatch`,
    );
    assertAlmostEquals(
      states[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-5,
      `Synapse ${i}: totalNegativeActivation mismatch`,
    );
  }
});

/**
 * Test batch 4-way with tiny activations below plankConstant threshold.
 */
Deno.test("AccumulateWeightBatch4Way-TinyActivations", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    plankConstant: 0.000_001,
  });

  // Activations below plankConstant threshold
  const currentWeights = [0.5, 0.5, 0.5, 0.5];
  const targetValues = [1.0, 1.0, 1.0, 1.0];
  const activations = [0.000_000_01, -0.000_000_01, 0.1, -0.1]; // Mix of tiny and normal

  const states = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];
  const singleStates = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  // Single calls
  for (let i = 0; i < 4; i++) {
    accumulateWeight(
      currentWeights[i],
      singleStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  // Batch call
  accumulateWeightBatch4Way(
    currentWeights,
    states,
    targetValues,
    activations,
    config,
  );

  // Verify results match (tiny activations should still be counted but not tracked)
  for (let i = 0; i < 4; i++) {
    assertEquals(states[i].count, singleStates[i].count);
    assertAlmostEquals(
      states[i].totalPositiveActivation,
      singleStates[i].totalPositiveActivation,
      1e-6,
    );
    assertAlmostEquals(
      states[i].totalNegativeActivation,
      singleStates[i].totalNegativeActivation,
      1e-6,
    );
  }
});

/**
 * Test batch 4-way with weight limiting.
 */
Deno.test("AccumulateWeightBatch4Way-WeightLimiting", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumWeightAdjustmentScale: 0.5,
    limitWeightScale: 100,
  });

  // Large target values that would trigger weight limiting
  const currentWeights = [0.5, 0.5, 0.5, 0.5];
  const targetValues = [100.0, -100.0, 50.0, -50.0];
  const activations = [1.0, -1.0, 1.0, -1.0];

  const states = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];
  const singleStates = [
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
    new SynapseState(),
  ];

  // Single calls
  for (let i = 0; i < 4; i++) {
    accumulateWeight(
      currentWeights[i],
      singleStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  // Batch call
  accumulateWeightBatch4Way(
    currentWeights,
    states,
    targetValues,
    activations,
    config,
  );

  // Verify results match with weight limiting
  for (let i = 0; i < 4; i++) {
    assertAlmostEquals(
      states[i].totalPositiveAdjustedValue,
      singleStates[i].totalPositiveAdjustedValue,
      1e-5,
      `Synapse ${i}: totalPositiveAdjustedValue mismatch with limiting`,
    );
    assertAlmostEquals(
      states[i].totalNegativeAdjustedValue,
      singleStates[i].totalNegativeAdjustedValue,
      1e-5,
      `Synapse ${i}: totalNegativeAdjustedValue mismatch with limiting`,
    );
  }
});
