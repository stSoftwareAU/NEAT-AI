/**
 * Issue #1214 - SIMD Batch Weight and Bias Gradient Accumulation
 *
 * Tests for batch bias accumulation functions that process 4 or 8
 * neurons simultaneously for improved performance during backpropagation.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { NeuronState } from "../../src/architecture/CreatureState.ts";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import {
  accumulateBias,
  accumulateBiasBatch4Way,
  accumulateBiasBatch8Way,
} from "../../src/propagate/Bias.ts";

/**
 * Test that batch 4-way accumulation produces the same results as
 * calling accumulateBias 4 times individually.
 */
Deno.test("accumulateBiasBatch4Way - matches individual accumulateBias calls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  // Test data: 4 neurons with different biases, pre-activation values, and targets
  const currentBiases = [0.5, -0.3, 1.2, 0.0];
  const targetPreActivationValues = [2.0, -1.5, 0.8, 3.0];
  const preActivationValues = [1.0, -0.5, 0.2, 2.5];

  // Create individual NeuronStates for single-call approach
  const singleStates = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  // Create NeuronStates for batch approach
  const batchStates = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  // Single calls
  for (let i = 0; i < 4; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  // Batch call
  accumulateBiasBatch4Way(
    batchStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  // Verify results match
  for (let i = 0; i < 4; i++) {
    assertEquals(
      batchStates[i].count,
      singleStates[i].count,
      `Neuron ${i}: count mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalBias,
      singleStates[i].totalBias,
      1e-6,
      `Neuron ${i}: totalBias mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-6,
      `Neuron ${i}: totalAdjustedBias mismatch`,
    );
  }
});

/**
 * Test batch 4-way with positive bias deltas.
 */
Deno.test("accumulateBiasBatch4Way - positive deltas accumulate correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.0, 0.0, 0.0, 0.0];
  const targetPreActivationValues = [2.0, 3.0, 4.0, 5.0];
  const preActivationValues = [1.0, 1.0, 1.0, 1.0];
  // Deltas will be: 1.0, 2.0, 3.0, 4.0

  const states = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  accumulateBiasBatch4Way(
    states,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  // Verify counts and positive deltas
  for (let i = 0; i < 4; i++) {
    assertEquals(states[i].count, 1, `Neuron ${i}: count should be 1`);
    const expectedDelta = targetPreActivationValues[i] - preActivationValues[i];
    const expectedTargetBias = currentBiases[i] + expectedDelta;
    assertAlmostEquals(
      states[i].totalBias,
      expectedTargetBias,
      1e-6,
      `Neuron ${i}: totalBias should reflect delta`,
    );
  }
});

/**
 * Test batch 4-way with negative bias deltas.
 */
Deno.test("accumulateBiasBatch4Way - negative deltas accumulate correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.0, 0.0, 0.0, 0.0];
  const targetPreActivationValues = [1.0, 1.0, 1.0, 1.0];
  const preActivationValues = [2.0, 3.0, 4.0, 5.0];
  // Deltas will be: -1.0, -2.0, -3.0, -4.0

  const states = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  accumulateBiasBatch4Way(
    states,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  for (let i = 0; i < 4; i++) {
    assertEquals(states[i].count, 1, `Neuron ${i}: count should be 1`);
    const expectedDelta = targetPreActivationValues[i] - preActivationValues[i];
    const expectedTargetBias = currentBiases[i] + expectedDelta;
    assertAlmostEquals(
      states[i].totalBias,
      expectedTargetBias,
      1e-6,
      `Neuron ${i}: totalBias should reflect negative delta`,
    );
  }
});

/**
 * Test batch 4-way with mixed bias deltas.
 */
Deno.test("accumulateBiasBatch4Way - mixed deltas match individual calls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.5, -0.5, 0.5, -0.5];
  const targetPreActivationValues = [2.0, 0.5, 0.0, -1.0];
  const preActivationValues = [1.0, 1.0, 1.0, 1.0];
  // Deltas will be: 1.0, -0.5, -1.0, -2.0

  const states = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];
  const singleStates = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  // Single calls
  for (let i = 0; i < 4; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  // Batch call
  accumulateBiasBatch4Way(
    states,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  for (let i = 0; i < 4; i++) {
    assertAlmostEquals(
      states[i].totalBias,
      singleStates[i].totalBias,
      1e-6,
      `Neuron ${i}: totalBias mismatch`,
    );
    assertAlmostEquals(
      states[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-6,
      `Neuron ${i}: totalAdjustedBias mismatch`,
    );
  }
});

/**
 * Test batch 4-way called multiple times accumulates correctly.
 */
Deno.test("accumulateBiasBatch4Way - multiple iterations accumulate correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  // Run multiple batches and verify accumulation
  const states = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];
  const singleStates = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  const iterations = 10;
  for (let iter = 0; iter < iterations; iter++) {
    const currentBiases = [0.5, -0.3, 1.2, 0.0];
    const targetPreActivationValues = [
      Math.sin(iter),
      Math.cos(iter),
      Math.sin(iter * 2),
      Math.cos(iter * 2),
    ];
    const preActivationValues = [
      Math.cos(iter) * 0.5,
      Math.sin(iter) * 0.5,
      Math.cos(iter * 2) * 0.5,
      Math.sin(iter * 2) * 0.5,
    ];

    // Single calls
    for (let i = 0; i < 4; i++) {
      accumulateBias(
        singleStates[i],
        targetPreActivationValues[i],
        preActivationValues[i],
        currentBiases[i],
        config,
      );
    }

    // Batch call
    accumulateBiasBatch4Way(
      states,
      targetPreActivationValues,
      preActivationValues,
      currentBiases,
      config,
    );
  }

  // Verify results match after all iterations
  for (let i = 0; i < 4; i++) {
    assertEquals(
      states[i].count,
      singleStates[i].count,
      `Neuron ${i}: count mismatch after ${iterations} iterations`,
    );
    assertAlmostEquals(
      states[i].totalBias,
      singleStates[i].totalBias,
      1e-5,
      `Neuron ${i}: totalBias mismatch`,
    );
    assertAlmostEquals(
      states[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-5,
      `Neuron ${i}: totalAdjustedBias mismatch`,
    );
  }
});

/**
 * Test that batch 8-way accumulation produces the same results as
 * calling accumulateBias 8 times individually.
 */
Deno.test("accumulateBiasBatch8Way - matches individual accumulateBias calls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  // Test data: 8 neurons with different biases, pre-activation values, and targets
  const currentBiases = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8, -0.5, 1.5];
  const targetPreActivationValues = [2.0, -1.5, 0.8, 3.0, -2.0, 1.0, -0.5, 2.5];
  const preActivationValues = [1.0, -0.5, 0.2, 2.5, -1.5, 0.5, 0.1, 1.0];

  // Create individual NeuronStates for single-call approach
  const singleStates: NeuronState[] = [];
  for (let i = 0; i < 8; i++) {
    singleStates.push(new NeuronState());
  }

  // Create NeuronStates for batch approach
  const batchStates: NeuronState[] = [];
  for (let i = 0; i < 8; i++) {
    batchStates.push(new NeuronState());
  }

  // Single calls
  for (let i = 0; i < 8; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  // Batch call
  accumulateBiasBatch8Way(
    batchStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  // Verify results match
  for (let i = 0; i < 8; i++) {
    assertEquals(
      batchStates[i].count,
      singleStates[i].count,
      `Neuron ${i}: count mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalBias,
      singleStates[i].totalBias,
      1e-6,
      `Neuron ${i}: totalBias mismatch`,
    );
    assertAlmostEquals(
      batchStates[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-6,
      `Neuron ${i}: totalAdjustedBias mismatch`,
    );
  }
});

/**
 * Test batch 8-way with multiple iterations.
 */
Deno.test("accumulateBiasBatch8Way - multiple iterations accumulate correctly", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  // Run multiple batches and verify accumulation
  const states: NeuronState[] = [];
  const singleStates: NeuronState[] = [];
  for (let i = 0; i < 8; i++) {
    states.push(new NeuronState());
    singleStates.push(new NeuronState());
  }

  const iterations = 10;
  for (let iter = 0; iter < iterations; iter++) {
    const currentBiases = [0.5, -0.3, 1.2, 0.0, -1.0, 0.8, -0.5, 1.5];
    const targetPreActivationValues: number[] = [];
    const preActivationValues: number[] = [];

    for (let i = 0; i < 8; i++) {
      targetPreActivationValues.push(Math.sin(iter + i * 0.5));
      preActivationValues.push(Math.cos(iter + i * 0.3) * 0.5);
    }

    // Single calls
    for (let i = 0; i < 8; i++) {
      accumulateBias(
        singleStates[i],
        targetPreActivationValues[i],
        preActivationValues[i],
        currentBiases[i],
        config,
      );
    }

    // Batch call
    accumulateBiasBatch8Way(
      states,
      targetPreActivationValues,
      preActivationValues,
      currentBiases,
      config,
    );
  }

  // Verify results match after all iterations
  for (let i = 0; i < 8; i++) {
    assertEquals(
      states[i].count,
      singleStates[i].count,
      `Neuron ${i}: count mismatch after ${iterations} iterations`,
    );
    assertAlmostEquals(
      states[i].totalBias,
      singleStates[i].totalBias,
      1e-5,
      `Neuron ${i}: totalBias mismatch`,
    );
    assertAlmostEquals(
      states[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-5,
      `Neuron ${i}: totalAdjustedBias mismatch`,
    );
  }
});

/**
 * Test batch 4-way with bias limiting.
 */
Deno.test("accumulateBiasBatch4Way - bias limiting matches individual calls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumBiasAdjustmentScale: 0.5,
    limitBiasScale: 100,
  });

  // Large target values that would trigger bias limiting
  const currentBiases = [0.5, 0.5, 0.5, 0.5];
  const targetPreActivationValues = [100.0, -100.0, 50.0, -50.0];
  const preActivationValues = [0.0, 0.0, 0.0, 0.0];

  const states = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];
  const singleStates = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  // Single calls
  for (let i = 0; i < 4; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  // Batch call
  accumulateBiasBatch4Way(
    states,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  // Verify results match with bias limiting
  for (let i = 0; i < 4; i++) {
    assertAlmostEquals(
      states[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-5,
      `Neuron ${i}: totalAdjustedBias mismatch with limiting`,
    );
  }
});

/**
 * Test batch 4-way with zero deltas (no change).
 */
Deno.test("accumulateBiasBatch4Way - zero deltas preserve current bias", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.5, -0.3, 1.2, 0.0];
  const targetPreActivationValues = [1.0, 1.0, 1.0, 1.0];
  const preActivationValues = [1.0, 1.0, 1.0, 1.0]; // Same as target, so delta = 0

  const states = [
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
    new NeuronState(),
  ];

  accumulateBiasBatch4Way(
    states,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  // With zero deltas, targetBias = currentBias
  for (let i = 0; i < 4; i++) {
    assertEquals(states[i].count, 1, `Neuron ${i}: count should be 1`);
    assertAlmostEquals(
      states[i].totalBias,
      currentBiases[i],
      1e-6,
      `Neuron ${i}: totalBias should equal currentBias when delta is zero`,
    );
  }
});
