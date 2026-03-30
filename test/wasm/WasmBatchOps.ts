/**
 * Tests for WASM batch operations — amortising boundary crossing overhead
 * by grouping multiple operations into single WASM calls.
 *
 * Issue #1960: Batch API design for amortising WASM boundary crossing.
 *
 * Tests verify that batch results match individual call results.
 */

import { assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { TypedTopology } from "@architecture/TypedTopology.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  calculateBiasBatch4Way,
  calculateWeightBatch4Way,
  validateTopologyBatch,
} from "../../src/wasm/WasmBatchOps.ts";
import { TOPOLOGY_VALID } from "../../src/wasm/WasmTopologyOps.ts";
import {
  wasmCalculateBias,
  wasmCalculateWeight,
} from "../../src/wasm/WasmStandaloneFunctions.ts";
import { SynapseState } from "@propagate/SynapseState.ts";
import type { BackPropagationConfig } from "@propagate/BackPropagation.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple 2-input, 1-hidden, 1-output creature. */
function makeSimpleCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-0", squash: "IDENTITY", bias: 0.5 },
      { type: "output", uuid: "output-0", squash: "TANH", bias: -0.3 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-0", weight: 0.7 },
      { fromUUID: "input-1", toUUID: "hidden-0", weight: -0.2 },
      { fromUUID: "hidden-0", toUUID: "output-0", weight: 1.5 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Larger creature with multiple hidden neurons and outputs. */
function makeLargerCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 3,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "h-0", squash: "ReLU", bias: 0.1 },
      { type: "hidden", uuid: "h-1", squash: "LOGISTIC", bias: -0.5 },
      { type: "hidden", uuid: "h-2", squash: "TANH", bias: 0.0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.2 },
      { type: "output", uuid: "output-1", squash: "LOGISTIC", bias: -0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-0", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "h-1", weight: -0.3 },
      { fromUUID: "input-2", toUUID: "h-2", weight: 0.8 },
      { fromUUID: "h-0", toUUID: "h-1", weight: 0.4 },
      { fromUUID: "h-0", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "h-1", toUUID: "output-0", weight: -0.7 },
      { fromUUID: "h-2", toUUID: "output-1", weight: 0.9 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Minimal creature (input directly to output). */
function makeMinimalCreature(): Creature {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.3 },
      { fromUUID: "input-1", toUUID: "output-0", weight: 0.4 },
    ],
  });
  creature.validate();
  CreatureUtil.makeUUID(creature);
  return creature;
}

/** Create a mock BackPropagationConfig for testing. */
function makeTestConfig(): BackPropagationConfig {
  return {
    plankConstant: 1e-7,
    learningRate: 0.3,
    maximumWeightAdjustmentScale: 1.0,
    limitWeightScale: 100000.0,
    maximumBiasAdjustmentScale: 1.0,
    limitBiasScale: 10000.0,
    generations: 1.0,
    l1WeightDecay: 0,
    l2WeightDecay: 0,
    l1BiasDecay: 0,
    l2BiasDecay: 0,
    batchSize: 64,
    disableWeightAdjustment: false,
    disableBiasAdjustment: false,
    disableRandomSamples: false,
    trainingMutationRate: 0,
    sparseRatio: 0,
    learningRateStrategy: "fixed" as const,
    initialLearningRate: 0.3,
    learningRateDecay: 0,
    warmRestartPeriod: 10,
    biasWeightCoordinationFactor: 0.2,
    dropoutRate: 0,
    normaliseGradients: false,
  } as BackPropagationConfig;
}

/** Create a SynapseState with accumulated data. */
function makeSynapseState(
  count: number,
  totalPosAct: number,
  totalNegAct: number,
  countPos: number,
  countNeg: number,
  totalPosAdj: number,
  totalNegAdj: number,
): SynapseState {
  const cs = new SynapseState();
  cs.count = count;
  cs.totalPositiveActivation = totalPosAct;
  cs.totalNegativeActivation = totalNegAct;
  cs.countPositiveActivations = countPos;
  cs.countNegativeActivations = countNeg;
  cs.totalPositiveAdjustedValue = totalPosAdj;
  cs.totalNegativeAdjustedValue = totalNegAdj;
  return cs;
}

// ===========================================================================
// 1. Batch Topology Validation
// ===========================================================================

Deno.test("validateTopologyBatch: validates multiple valid topologies", () => {
  const creatures = [
    makeSimpleCreature(),
    makeLargerCreature(),
    makeMinimalCreature(),
  ];
  const topologies = creatures.map((c) => TypedTopology.fromCreature(c));

  const results = validateTopologyBatch(topologies);

  assertEquals(results.length, 3);
  for (const result of results) {
    assertEquals(result.valid, true);
    assertEquals(result.errorCode, TOPOLOGY_VALID);
  }
});

Deno.test("validateTopologyBatch: empty array returns empty results", () => {
  const results = validateTopologyBatch([]);
  assertEquals(results.length, 0);
});

Deno.test("validateTopologyBatch: single topology works", () => {
  const creature = makeSimpleCreature();
  const topo = TypedTopology.fromCreature(creature);

  const results = validateTopologyBatch([topo]);

  assertEquals(results.length, 1);
  assertEquals(results[0].valid, true);
});

Deno.test("validateTopologyBatch: detects invalid topology in batch", () => {
  const validCreature = makeSimpleCreature();
  const validTopo = TypedTopology.fromCreature(validCreature);

  // Create an invalid topology with a backward connection
  const invalidTopo = {
    fromIndices: new Uint32Array([3, 0]),
    toIndices: new Uint32Array([1, 2]),
    biases: new Float64Array(4),
    squashTypes: new Uint8Array(4),
    weights: new Float64Array(2),
    synapseTypes: new Uint8Array(2),
    isConstant: new Uint8Array(4),
    numNeurons: 4,
    numInputs: 2,
    numOutputs: 1,
    numSynapses: 2,
  } as unknown as TypedTopology;

  const results = validateTopologyBatch([validTopo, invalidTopo]);

  assertEquals(results.length, 2);
  assertEquals(results[0].valid, true);
  assertEquals(results[1].valid, false);
});

Deno.test("validateTopologyBatch: handles four topologies", () => {
  const creatures = [
    makeSimpleCreature(),
    makeLargerCreature(),
    makeMinimalCreature(),
    makeSimpleCreature(),
  ];
  const topologies = creatures.map((c) => TypedTopology.fromCreature(c));

  const results = validateTopologyBatch(topologies);

  assertEquals(results.length, 4);
  for (const result of results) {
    assertEquals(result.valid, true);
  }
});

// ===========================================================================
// 2. Batch Weight Calculation
// ===========================================================================

Deno.test("calculateWeightBatch4Way: matches individual calculateWeight calls", () => {
  const config = makeTestConfig();

  const states: SynapseState[] = [
    makeSynapseState(10, 5.0, 3.0, 6, 4, 12.0, -8.0),
    makeSynapseState(5, 2.5, 1.0, 3, 2, 6.0, -2.5),
    makeSynapseState(20, 10.0, 8.0, 12, 8, 25.0, -20.0),
    makeSynapseState(1, 1.0, 0.0, 1, 0, 2.0, 0.0),
  ];
  const currentWeights = [0.5, -0.3, 1.2, 0.0];

  const batchResults = calculateWeightBatch4Way(states, currentWeights, config);

  assertEquals(batchResults.length, 4);

  // Compare with individual WASM calculateWeight calls
  for (let i = 0; i < 4; i++) {
    const individual = wasmCalculateWeight(
      states[i],
      currentWeights[i],
      config,
    );
    assertAlmostEquals(
      batchResults[i],
      individual,
      1e-10,
      `Weight ${i}: batch=${batchResults[i]} individual=${individual}`,
    );
  }
});

Deno.test("calculateWeightBatch4Way: handles zero-count states", () => {
  const config = makeTestConfig();

  const states: SynapseState[] = [
    makeSynapseState(0, 0, 0, 0, 0, 0, 0),
    makeSynapseState(0, 0, 0, 0, 0, 0, 0),
    makeSynapseState(0, 0, 0, 0, 0, 0, 0),
    makeSynapseState(0, 0, 0, 0, 0, 0, 0),
  ];
  const currentWeights = [0.5, -0.3, 1.2, 0.0];

  const results = calculateWeightBatch4Way(states, currentWeights, config);

  assertEquals(results.length, 4);
  for (let i = 0; i < 4; i++) {
    assertEquals(results[i], currentWeights[i]);
  }
});

Deno.test("calculateWeightBatch4Way: handles mixed zero and non-zero counts", () => {
  const config = makeTestConfig();

  const states: SynapseState[] = [
    makeSynapseState(10, 5.0, 3.0, 6, 4, 12.0, -8.0),
    makeSynapseState(0, 0, 0, 0, 0, 0, 0),
    makeSynapseState(5, 2.5, 0.0, 5, 0, 8.0, 0.0),
    makeSynapseState(0, 0, 0, 0, 0, 0, 0),
  ];
  const currentWeights = [0.5, -0.3, 1.2, 0.7];

  const results = calculateWeightBatch4Way(states, currentWeights, config);

  // Zero-count states should return current weight
  assertEquals(results[1], currentWeights[1]);
  assertEquals(results[3], currentWeights[3]);

  // Non-zero count states should match individual calls
  for (const idx of [0, 2]) {
    const individual = wasmCalculateWeight(
      states[idx],
      currentWeights[idx],
      config,
    );
    assertAlmostEquals(results[idx], individual, 1e-10);
  }
});

// ===========================================================================
// 3. Batch Bias Calculation
// ===========================================================================

Deno.test("calculateBiasBatch4Way: matches individual calculateBias calls", () => {
  const config = makeTestConfig();

  const counts = [10, 5, 20, 1];
  const totalAdjustedBiases = [15.0, 2.5, 45.0, 1.5];
  const currentBiases = [0.5, -0.3, 1.2, 0.0];
  const noChanges = [false, false, false, false];

  const batchResults = calculateBiasBatch4Way(
    counts,
    totalAdjustedBiases,
    currentBiases,
    noChanges,
    config,
  );

  assertEquals(batchResults.length, 4);

  for (let i = 0; i < 4; i++) {
    const individual = wasmCalculateBias(
      counts[i],
      totalAdjustedBiases[i],
      currentBiases[i],
      noChanges[i],
      config,
    );
    assertAlmostEquals(
      batchResults[i],
      individual,
      1e-10,
      `Bias ${i}: batch=${batchResults[i]} individual=${individual}`,
    );
  }
});

Deno.test("calculateBiasBatch4Way: zero-count returns current bias", () => {
  const config = makeTestConfig();

  const counts = [0, 0, 0, 0];
  const totalAdjustedBiases = [0, 0, 0, 0];
  const currentBiases = [0.5, -0.3, 1.2, 0.0];
  const noChanges = [false, false, false, false];

  const results = calculateBiasBatch4Way(
    counts,
    totalAdjustedBiases,
    currentBiases,
    noChanges,
    config,
  );

  assertEquals(results.length, 4);
  for (let i = 0; i < 4; i++) {
    assertEquals(results[i], currentBiases[i]);
  }
});

Deno.test("calculateBiasBatch4Way: noChange returns current bias", () => {
  const config = makeTestConfig();

  const counts = [10, 10, 10, 10];
  const totalAdjustedBiases = [15.0, 12.0, 8.0, 20.0];
  const currentBiases = [0.5, -0.3, 1.2, 0.7];
  const noChanges = [true, true, true, true];

  const results = calculateBiasBatch4Way(
    counts,
    totalAdjustedBiases,
    currentBiases,
    noChanges,
    config,
  );

  assertEquals(results.length, 4);
  for (let i = 0; i < 4; i++) {
    assertEquals(results[i], currentBiases[i]);
  }
});

Deno.test("calculateBiasBatch4Way: mixed noChange and active biases", () => {
  const config = makeTestConfig();

  const counts = [10, 5, 0, 8];
  const totalAdjustedBiases = [15.0, 2.5, 0, 12.0];
  const currentBiases = [0.5, -0.3, 1.2, 0.7];
  const noChanges = [false, true, false, false];

  const results = calculateBiasBatch4Way(
    counts,
    totalAdjustedBiases,
    currentBiases,
    noChanges,
    config,
  );

  assertEquals(results.length, 4);

  // noChange=true should return current bias
  assertEquals(results[1], currentBiases[1]);

  // zero count should return current bias
  assertEquals(results[2], currentBiases[2]);
});
