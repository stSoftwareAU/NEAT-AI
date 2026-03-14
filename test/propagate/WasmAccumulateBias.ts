/**
 * Issue #1518 - WASM Bias Batch Accumulation Tests
 *
 * Verifies that the WASM bias accumulation functions produce identical
 * results to the TypeScript implementations. These tests exercise the
 * WASM→TS boundary and validate the packed array unpacking logic.
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
 * Verify the WASM-integrated 4-way batch produces the same results as
 * single calls (WASM is tried first, falls back to TS if unavailable).
 */
Deno.test("wasmAccumulateBiasBatch4Way - matches individual TypeScript calls", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.5, -0.3, 1.2, 0.0];
  const targetPreActivationValues = [2.0, -1.5, 0.8, 3.0];
  const preActivationValues = [1.0, -0.5, 0.2, 2.5];

  const singleStates = Array.from({ length: 4 }, () => new NeuronState());
  const batchStates = Array.from({ length: 4 }, () => new NeuronState());

  for (let i = 0; i < 4; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  accumulateBiasBatch4Way(
    batchStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  for (let i = 0; i < 4; i++) {
    assertEquals(batchStates[i].count, singleStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      batchStates[i].totalBias,
      singleStates[i].totalBias,
      1e-6,
      `totalBias[${i}]`,
    );
    assertAlmostEquals(
      batchStates[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-6,
      `totalAdjustedBias[${i}]`,
    );
  }
});

/**
 * Verify the WASM-integrated 8-way batch produces the same results.
 */
Deno.test("wasmAccumulateBiasBatch8Way - matches individual TypeScript calls", () => {
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

  const singleStates = Array.from({ length: 8 }, () => new NeuronState());
  const batchStates = Array.from({ length: 8 }, () => new NeuronState());

  for (let i = 0; i < 8; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  accumulateBiasBatch8Way(
    batchStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  for (let i = 0; i < 8; i++) {
    assertEquals(batchStates[i].count, singleStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      batchStates[i].totalBias,
      singleStates[i].totalBias,
      1e-6,
      `totalBias[${i}]`,
    );
    assertAlmostEquals(
      batchStates[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-6,
      `totalAdjustedBias[${i}]`,
    );
  }
});

/**
 * Test multiple iterations to verify accumulation stability.
 */
Deno.test("wasmAccumulateBiasBatch4Way - multiple iterations match TypeScript", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const singleStates = Array.from({ length: 4 }, () => new NeuronState());
  const batchStates = Array.from({ length: 4 }, () => new NeuronState());

  for (let iter = 0; iter < 20; iter++) {
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

    for (let i = 0; i < 4; i++) {
      accumulateBias(
        singleStates[i],
        targetPreActivationValues[i],
        preActivationValues[i],
        currentBiases[i],
        config,
      );
    }

    accumulateBiasBatch4Way(
      batchStates,
      targetPreActivationValues,
      preActivationValues,
      currentBiases,
      config,
    );
  }

  for (let i = 0; i < 4; i++) {
    assertEquals(batchStates[i].count, singleStates[i].count);
    assertAlmostEquals(
      batchStates[i].totalBias,
      singleStates[i].totalBias,
      1e-5,
    );
    assertAlmostEquals(
      batchStates[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-5,
    );
  }
});

/**
 * Test non-finite value handling (Issue #1314).
 */
Deno.test("wasmAccumulateBiasBatch4Way - skips non-finite values like TypeScript", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
  });

  const currentBiases = [0.5, NaN, Infinity, -Infinity];
  const targetPreActivationValues = [2.0, 1.0, 1.0, 1.0];
  const preActivationValues = [1.0, 0.5, 0.5, 0.5];

  const singleStates = Array.from({ length: 4 }, () => new NeuronState());
  const batchStates = Array.from({ length: 4 }, () => new NeuronState());

  for (let i = 0; i < 4; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  accumulateBiasBatch4Way(
    batchStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  // Only the first neuron should have been accumulated
  assertEquals(batchStates[0].count, 1);
  assertEquals(batchStates[1].count, 0);
  assertEquals(batchStates[2].count, 0);
  assertEquals(batchStates[3].count, 0);

  for (let i = 0; i < 4; i++) {
    assertEquals(batchStates[i].count, singleStates[i].count);
  }
});

/**
 * Test with bias limiting configuration.
 */
Deno.test("wasmAccumulateBiasBatch4Way - bias limiting matches TypeScript", () => {
  const config = createBackPropagationConfig({
    generations: 0,
    learningRate: 1,
    maximumBiasAdjustmentScale: 0.5,
    limitBiasScale: 100,
  });

  const currentBiases = [0.5, 0.5, 0.5, 0.5];
  const targetPreActivationValues = [100.0, -100.0, 50.0, -50.0];
  const preActivationValues = [0.0, 0.0, 0.0, 0.0];

  const singleStates = Array.from({ length: 4 }, () => new NeuronState());
  const batchStates = Array.from({ length: 4 }, () => new NeuronState());

  for (let i = 0; i < 4; i++) {
    accumulateBias(
      singleStates[i],
      targetPreActivationValues[i],
      preActivationValues[i],
      currentBiases[i],
      config,
    );
  }

  accumulateBiasBatch4Way(
    batchStates,
    targetPreActivationValues,
    preActivationValues,
    currentBiases,
    config,
  );

  for (let i = 0; i < 4; i++) {
    assertAlmostEquals(
      batchStates[i].totalAdjustedBias,
      singleStates[i].totalAdjustedBias,
      1e-5,
      `totalAdjustedBias[${i}]`,
    );
  }
});
