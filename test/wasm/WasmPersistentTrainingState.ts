/**
 * Issue #1522 - Persistent Training State in WASM Linear Memory
 *
 * Tests that the persistent training state functions produce numerically
 * equivalent results to the current JS object marshalling approach.
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertExists,
} from "@std/assert";
import {
  createBackPropagationConfig,
} from "../../src/propagate/BackPropagation.ts";
import { SynapseState } from "../../src/propagate/SynapseState.ts";
import { NeuronState } from "../../src/architecture/CreatureState.ts";
import {
  accumulateWeight,
  accumulateWeightBatch4Way,
} from "../../src/propagate/Weight.ts";
import {
  accumulateBias,
  accumulateBiasBatch4Way,
} from "../../src/propagate/Bias.ts";
import {
  freeTrainingState,
  initTrainingState,
  readAllNeuronState,
  readAllSynapseState,
  readNeuronState,
  readSynapseState,
  resetTrainingState,
  unpackNeuronState,
  unpackSynapseState,
  wasmAccumulateBiasPersistent4Way,
  wasmAccumulateWeightPersistent4Way,
} from "../../src/wasm/WasmTrainingState.ts";

const config = createBackPropagationConfig({
  generations: 0,
  learningRate: 1,
  plankConstant: 0.000_000_1,
});

/**
 * Verify persistent weight accumulation matches single-call TypeScript.
 */
Deno.test("PersistentTrainingState-WeightMatchesSingleCalls", () => {
  const currentWeights = [0.5, -0.3, 1.2, 0.0];
  const targetValues = [2.0, -1.5, 0.8, 3.0];
  const activations = [1.0, 0.5, -0.8, 2.0];

  // TypeScript reference
  const tsStates = Array.from({ length: 4 }, () => new SynapseState());
  for (let i = 0; i < 4; i++) {
    accumulateWeight(
      currentWeights[i],
      tsStates[i],
      targetValues[i],
      activations[i],
      config,
    );
  }

  // Persistent WASM
  const wasInit = initTrainingState(4, 0);
  assert(wasInit, "WASM training state must initialise successfully");

  wasmAccumulateWeightPersistent4Way(
    0,
    currentWeights,
    targetValues,
    activations,
    config,
  );

  // Compare results
  for (let i = 0; i < 4; i++) {
    const persistent = readSynapseState(i);
    assertExists(persistent, `readSynapseState(${i}) must return data`);

    assertEquals(persistent[0], tsStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      persistent[1],
      tsStates[i].totalPositiveActivation,
      1e-6,
      `totalPositiveActivation[${i}]`,
    );
    assertAlmostEquals(
      persistent[2],
      tsStates[i].totalNegativeActivation,
      1e-6,
      `totalNegativeActivation[${i}]`,
    );
    assertAlmostEquals(
      persistent[3],
      tsStates[i].countPositiveActivations,
      1e-6,
      `countPositiveActivations[${i}]`,
    );
    assertAlmostEquals(
      persistent[4],
      tsStates[i].countNegativeActivations,
      1e-6,
      `countNegativeActivations[${i}]`,
    );
    assertAlmostEquals(
      persistent[5],
      tsStates[i].totalPositiveAdjustedValue,
      1e-6,
      `totalPositiveAdjustedValue[${i}]`,
    );
    assertAlmostEquals(
      persistent[6],
      tsStates[i].totalNegativeAdjustedValue,
      1e-6,
      `totalNegativeAdjustedValue[${i}]`,
    );
  }

  freeTrainingState();
});

/**
 * Verify persistent bias accumulation matches single-call TypeScript.
 */
Deno.test("PersistentTrainingState-BiasMatchesSingleCalls", () => {
  const targetPreActivations = [2.0, -1.5, 0.8, 3.0];
  const preActivations = [1.0, -0.5, 0.2, 2.5];
  const currentBiases = [0.5, -0.3, 1.2, 0.0];

  // TypeScript reference
  const tsStates = Array.from({ length: 4 }, () => new NeuronState());
  for (let i = 0; i < 4; i++) {
    accumulateBias(
      tsStates[i],
      targetPreActivations[i],
      preActivations[i],
      currentBiases[i],
      config,
    );
  }

  // Persistent WASM
  const wasInit = initTrainingState(0, 4);
  assert(wasInit, "WASM training state must initialise successfully");

  wasmAccumulateBiasPersistent4Way(
    0,
    targetPreActivations,
    preActivations,
    currentBiases,
    config,
  );

  for (let i = 0; i < 4; i++) {
    const persistent = readNeuronState(i);
    assertExists(persistent, `readNeuronState(${i}) must return data`);

    assertEquals(persistent[0], tsStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      persistent[1],
      tsStates[i].totalBias,
      1e-6,
      `totalBias[${i}]`,
    );
    assertAlmostEquals(
      persistent[2],
      tsStates[i].totalAdjustedBias,
      1e-6,
      `totalAdjustedBias[${i}]`,
    );
  }

  freeTrainingState();
});

/**
 * Verify multiple iterations accumulate correctly in persistent state.
 */
Deno.test("PersistentTrainingState-MultipleIterations", () => {
  const wasInit = initTrainingState(4, 0);
  assert(wasInit, "WASM training state must initialise successfully");

  const tsStates = Array.from({ length: 4 }, () => new SynapseState());

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

    // TypeScript reference
    for (let i = 0; i < 4; i++) {
      accumulateWeight(
        currentWeights[i],
        tsStates[i],
        targetValues[i],
        activations[i],
        config,
      );
    }

    // Persistent WASM
    wasmAccumulateWeightPersistent4Way(
      0,
      currentWeights,
      targetValues,
      activations,
      config,
    );
  }

  for (let i = 0; i < 4; i++) {
    const persistent = readSynapseState(i);
    assertExists(persistent, `readSynapseState(${i}) must return data`);

    assertEquals(persistent[0], tsStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      persistent[1],
      tsStates[i].totalPositiveActivation,
      1e-5,
      `totalPositiveActivation[${i}]`,
    );
    assertAlmostEquals(
      persistent[2],
      tsStates[i].totalNegativeActivation,
      1e-5,
      `totalNegativeActivation[${i}]`,
    );
  }

  freeTrainingState();
});

/**
 * Verify reset zeros state without deallocation.
 */
Deno.test("PersistentTrainingState-ResetZeroesState", () => {
  const wasInit = initTrainingState(4, 2);
  assert(wasInit, "WASM training state must initialise successfully");

  // Accumulate some data
  wasmAccumulateWeightPersistent4Way(
    0,
    [0.5, -0.3, 1.2, 0.0],
    [2.0, -1.5, 0.8, 3.0],
    [1.0, 0.5, -0.8, 2.0],
    config,
  );

  // Verify non-zero
  const before = readSynapseState(0);
  assertExists(before, "readSynapseState(0) must return data");
  assert(before[0] > 0, "count should be > 0 before reset");

  // Reset
  resetTrainingState();

  // Verify zeroed
  const after = readSynapseState(0);
  assertExists(after, "readSynapseState(0) must return data after reset");
  for (let i = 0; i < 7; i++) {
    assertEquals(after[i], 0, `field ${i} should be 0 after reset`);
  }

  freeTrainingState();
});

/**
 * Verify unpack functions correctly transfer state to JS objects.
 */
Deno.test("PersistentTrainingState-UnpackSynapseState", () => {
  const wasInit = initTrainingState(4, 0);
  assert(wasInit, "WASM training state must initialise successfully");

  wasmAccumulateWeightPersistent4Way(
    0,
    [0.5, -0.3, 1.2, 0.0],
    [2.0, -1.5, 0.8, 3.0],
    [1.0, 0.5, -0.8, 2.0],
    config,
  );

  const cs = new SynapseState();
  const unpacked = unpackSynapseState(0, cs);
  assert(unpacked, "unpackSynapseState must succeed");

  assert(cs.count > 0, "count should be > 0");

  // Compare with direct read
  const direct = readSynapseState(0)!;
  assertEquals(cs.count, direct[0]);
  assertAlmostEquals(cs.totalPositiveActivation, direct[1], 1e-10);
  assertAlmostEquals(cs.totalNegativeActivation, direct[2], 1e-10);

  freeTrainingState();
});

/**
 * Verify unpack functions correctly transfer neuron state to JS objects.
 */
Deno.test("PersistentTrainingState-UnpackNeuronState", () => {
  const wasInit = initTrainingState(0, 4);
  assert(wasInit, "WASM training state must initialise successfully");

  wasmAccumulateBiasPersistent4Way(
    0,
    [2.0, -1.5, 0.8, 3.0],
    [1.0, -0.5, 0.2, 2.5],
    [0.5, -0.3, 1.2, 0.0],
    config,
  );

  const ns = new NeuronState();
  const unpacked = unpackNeuronState(0, ns);
  assert(unpacked, "unpackNeuronState must succeed");

  assert(ns.count > 0, "count should be > 0");

  const direct = readNeuronState(0)!;
  assertEquals(ns.count, direct[0]);
  assertAlmostEquals(ns.totalBias, direct[1], 1e-10);
  assertAlmostEquals(ns.totalAdjustedBias, direct[2], 1e-10);

  freeTrainingState();
});

/**
 * Verify non-finite values are handled correctly (Issue #1314).
 */
Deno.test("PersistentTrainingState-NonFiniteValues", () => {
  const wasInit = initTrainingState(4, 0);
  assert(wasInit, "WASM training state must initialise successfully");

  wasmAccumulateWeightPersistent4Way(
    0,
    [0.5, NaN, Infinity, -Infinity],
    [2.0, 1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0, 1.0],
    config,
  );

  // Only the first synapse should have been accumulated
  const s0 = readSynapseState(0);
  const s1 = readSynapseState(1);
  const s2 = readSynapseState(2);
  const s3 = readSynapseState(3);

  assertExists(s0, "readSynapseState(0) must return data");
  assertExists(s1, "readSynapseState(1) must return data");
  assertExists(s2, "readSynapseState(2) must return data");
  assertExists(s3, "readSynapseState(3) must return data");

  assertEquals(s0[0], 1, "synapse 0 count should be 1");
  assertEquals(s1[0], 0, "synapse 1 count should be 0 (NaN weight)");
  assertEquals(s2[0], 0, "synapse 2 count should be 0 (Infinity weight)");
  assertEquals(s3[0], 0, "synapse 3 count should be 0 (-Infinity weight)");

  freeTrainingState();
});

/**
 * Verify persistent state matches the batch 4-way approach.
 */
Deno.test("PersistentTrainingState-MatchesBatch4Way", () => {
  const currentWeights = [0.5, -0.3, 1.2, 0.0];
  const targetValues = [2.0, -1.5, 0.8, 3.0];
  const activations = [1.0, 0.5, -0.8, 2.0];

  // Batch approach (existing)
  const batchStates = Array.from({ length: 4 }, () => new SynapseState());
  accumulateWeightBatch4Way(
    currentWeights,
    batchStates,
    targetValues,
    activations,
    config,
  );

  // Persistent approach
  const wasInit = initTrainingState(4, 0);
  assert(wasInit, "WASM training state must initialise successfully");

  wasmAccumulateWeightPersistent4Way(
    0,
    currentWeights,
    targetValues,
    activations,
    config,
  );

  for (let i = 0; i < 4; i++) {
    const persistent = readSynapseState(i);
    assertExists(persistent, `readSynapseState(${i}) must return data`);

    assertEquals(persistent[0], batchStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      persistent[1],
      batchStates[i].totalPositiveActivation,
      1e-6,
      `totalPositiveActivation[${i}]`,
    );
    assertAlmostEquals(
      persistent[2],
      batchStates[i].totalNegativeActivation,
      1e-6,
      `totalNegativeActivation[${i}]`,
    );
    assertAlmostEquals(
      persistent[3],
      batchStates[i].countPositiveActivations,
      1e-6,
      `countPositiveActivations[${i}]`,
    );
    assertAlmostEquals(
      persistent[4],
      batchStates[i].countNegativeActivations,
      1e-6,
      `countNegativeActivations[${i}]`,
    );
    assertAlmostEquals(
      persistent[5],
      batchStates[i].totalPositiveAdjustedValue,
      1e-6,
      `totalPositiveAdjustedValue[${i}]`,
    );
    assertAlmostEquals(
      persistent[6],
      batchStates[i].totalNegativeAdjustedValue,
      1e-6,
      `totalNegativeAdjustedValue[${i}]`,
    );
  }

  freeTrainingState();
});

/**
 * Verify persistent bias state matches the batch 4-way approach.
 */
Deno.test("PersistentTrainingState-BiasMatchesBatch4Way", () => {
  const targetPreAct = [2.0, -1.5, 0.8, 3.0];
  const preAct = [1.0, -0.5, 0.2, 2.5];
  const biases = [0.5, -0.3, 1.2, 0.0];

  // Batch approach (existing)
  const batchStates = Array.from({ length: 4 }, () => new NeuronState());
  accumulateBiasBatch4Way(
    batchStates,
    targetPreAct,
    preAct,
    biases,
    config,
  );

  // Persistent approach
  const wasInit = initTrainingState(0, 4);
  assert(wasInit, "WASM training state must initialise successfully");

  wasmAccumulateBiasPersistent4Way(0, targetPreAct, preAct, biases, config);

  for (let i = 0; i < 4; i++) {
    const persistent = readNeuronState(i);
    assertExists(persistent, `readNeuronState(${i}) must return data`);

    assertEquals(persistent[0], batchStates[i].count, `count[${i}]`);
    assertAlmostEquals(
      persistent[1],
      batchStates[i].totalBias,
      1e-6,
      `totalBias[${i}]`,
    );
    assertAlmostEquals(
      persistent[2],
      batchStates[i].totalAdjustedBias,
      1e-6,
      `totalAdjustedBias[${i}]`,
    );
  }

  freeTrainingState();
});

/**
 * Verify bulk read matches individual reads.
 */
Deno.test("PersistentTrainingState-BulkReadMatchesIndividual", () => {
  const wasInit = initTrainingState(4, 2);
  assert(wasInit, "WASM training state must initialise successfully");

  wasmAccumulateWeightPersistent4Way(
    0,
    [0.5, -0.3, 1.2, 0.0],
    [2.0, -1.5, 0.8, 3.0],
    [1.0, 0.5, -0.8, 2.0],
    config,
  );

  wasmAccumulateBiasPersistent4Way(
    0,
    [2.0, -1.5, 0.0, 0.0],
    [1.0, -0.5, 0.0, 0.0],
    [0.5, -0.3, 0.0, 0.0],
    config,
  );

  // Bulk read
  const allSynapse = readAllSynapseState();
  const allNeuron = readAllNeuronState();

  assertExists(allSynapse, "readAllSynapseState must return data");
  assertExists(allNeuron, "readAllNeuronState must return data");

  // Compare with individual reads
  for (let i = 0; i < 4; i++) {
    const individual = readSynapseState(i)!;
    for (let f = 0; f < 7; f++) {
      assertEquals(
        allSynapse[i * 7 + f],
        individual[f],
        `synapse[${i}][${f}] bulk vs individual`,
      );
    }
  }

  for (let i = 0; i < 2; i++) {
    const individual = readNeuronState(i)!;
    for (let f = 0; f < 3; f++) {
      assertEquals(
        allNeuron[i * 3 + f],
        individual[f],
        `neuron[${i}][${f}] bulk vs individual`,
      );
    }
  }

  freeTrainingState();
});

/**
 * Verify the init/free cycle can be repeated without error.
 */
Deno.test("PersistentTrainingState-InitFreeIsRepeatable", () => {
  // Initialise and free multiple times to check for leaks
  for (let cycle = 0; cycle < 10; cycle++) {
    const wasInit = initTrainingState(100, 50);
    assert(wasInit, `WASM training state must initialise (cycle ${cycle})`);

    wasmAccumulateWeightPersistent4Way(
      0,
      [0.5, -0.3, 1.2, 0.0],
      [2.0, -1.5, 0.8, 3.0],
      [1.0, 0.5, -0.8, 2.0],
      config,
    );

    freeTrainingState();
  }
});

/**
 * Verify reinitialisation works correctly after free.
 */
Deno.test("PersistentTrainingState-ReinitialiseAfterFree", () => {
  // First epoch
  let wasInit = initTrainingState(4, 2);
  assert(wasInit, "WASM training state must initialise (first epoch)");

  wasmAccumulateWeightPersistent4Way(
    0,
    [0.5, -0.3, 1.2, 0.0],
    [2.0, -1.5, 0.8, 3.0],
    [1.0, 0.5, -0.8, 2.0],
    config,
  );

  freeTrainingState();

  // Second epoch with different size
  wasInit = initTrainingState(8, 4);
  assert(wasInit, "WASM training state must initialise (second epoch)");

  const s0 = readSynapseState(0);
  assertExists(s0, "readSynapseState(0) must return data after reinit");

  // Should be zeroed after reinitialisation
  assertEquals(s0[0], 0, "count should be 0 after reinitialisation");

  freeTrainingState();
});
