/**
 * ProductionScale.ts — Production-scale creature backpropagation convergence
 * validation.
 *
 * Issue #1875 — Validates that backpropagation converges on a creature matching
 * production scale (~1,000+ neurons, ~18,000+ synapses) with diverse squash
 * functions, aggregate neurons (IF, MAXIMUM, MINIMUM), and multiple layers of
 * depth.
 *
 * This test serves as a regression guard for future changes to backpropagation,
 * ensuring we never regress on large creature performance.
 */

import { assert, assertGreater, assertLess } from "@std/assert";
import type { CreatureExport } from "../../../src/architecture/CreatureInterfaces.ts";
import { Creature } from "../../../src/Creature.ts";
import { train } from "../../TrainTestOnlyUtil.ts";
import type { DataRecordInterface } from "../../../src/architecture/DataSet.ts";

/**
 * Deterministic seeded PRNG (mulberry32) for reproducible creature generation.
 */
function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Squash functions grouped by category to ensure diverse representation.
 * Excludes deprecated functions (HYPOT, HYPOTv2, MEAN).
 */
const SQUASH_CATEGORIES = {
  sigmoid: ["LOGISTIC", "BIPOLAR_SIGMOID", "LogSigmoid"],
  tanh: ["TANH", "HARD_TANH"],
  relu: ["ReLU", "LeakyReLU", "ELU", "SELU", "ReLU6"],
  smooth: ["Mish", "Swish", "GELU", "Softplus", "SOFTSIGN"],
  identity: ["IDENTITY"],
  trigonometric: ["SINE", "Cosine", "ArcTan", "TAN"],
  other: ["GAUSSIAN", "BENT_IDENTITY", "STEP", "BIPOLAR", "Exponential"],
};

const ALL_SQUASHES = Object.values(SQUASH_CATEGORIES).flat();

/** Aggregate squash functions requiring special connectivity (3+ inputs). */
const AGGREGATE_SQUASHES = ["IF", "MAXIMUM", "MINIMUM"];

/**
 * Generate a production-scale creature deterministically.
 *
 * Target: ~1,000+ neurons, ~18,000+ synapses with diverse squash functions,
 * multiple layers, aggregate neurons, and some recurrent connections.
 */
function generateProductionCreature(
  inputCount: number,
  outputCount: number,
  rng: () => number,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Layer configuration: 7 layers with varying widths for depth
  const layerWidths = [180, 220, 200, 160, 140, 100, 60];
  // Track UUIDs per layer for connectivity
  const layerUuids: string[][] = [];

  // Input UUIDs
  const inputUuids: string[] = [];
  for (let i = 0; i < inputCount; i++) {
    inputUuids.push(`input-${i}`);
  }

  // Build hidden layers
  let neuronCounter = 0;
  for (let layer = 0; layer < layerWidths.length; layer++) {
    const width = layerWidths[layer];
    const uuids: string[] = [];

    for (let n = 0; n < width; n++) {
      const uuid = `h-${layer}-${n}`;
      uuids.push(uuid);

      // Pick squash: mostly standard, ~5% aggregate
      let squash: string;
      if (rng() < 0.05 && layer > 0 && layer < layerWidths.length - 1) {
        squash = AGGREGATE_SQUASHES[
          Math.floor(rng() * AGGREGATE_SQUASHES.length)
        ];
      } else {
        squash = ALL_SQUASHES[Math.floor(rng() * ALL_SQUASHES.length)];
      }

      const bias = (rng() - 0.5) * 2;
      neurons.push({ type: "hidden", uuid, squash, bias });
      neuronCounter++;
    }
    layerUuids.push(uuids);
  }

  // Output neurons
  const outputUuids: string[] = [];
  for (let o = 0; o < outputCount; o++) {
    const uuid = `output-${o}`;
    outputUuids.push(uuid);
    neurons.push({
      type: "output",
      uuid,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  // Build synapses: primarily feedforward with skip connections
  const addedSynapses = new Set<string>();
  function addSynapse(
    fromUUID: string,
    toUUID: string,
    weight: number,
    type?: "positive" | "negative" | "condition",
  ) {
    const key = `${fromUUID}->${toUUID}`;
    if (addedSynapses.has(key)) return;
    addedSynapses.add(key);
    if (type) {
      synapses.push({ fromUUID, toUUID, weight, type });
    } else {
      synapses.push({ fromUUID, toUUID, weight });
    }
  }

  /**
   * Wire IF neurons with the required condition, positive, and negative
   * typed connections from the given source pool.
   */
  function wireIfNeuron(
    toUuid: string,
    sourcePool: string[],
    extraCount: number,
  ) {
    // IF requires at least one condition, one positive, one negative
    const condIdx = Math.floor(rng() * sourcePool.length);
    addSynapse(sourcePool[condIdx], toUuid, (rng() - 0.5) * 2, "condition");
    const posIdx = Math.floor(rng() * sourcePool.length);
    addSynapse(sourcePool[posIdx], toUuid, (rng() - 0.5) * 2, "positive");
    const negIdx = Math.floor(rng() * sourcePool.length);
    addSynapse(sourcePool[negIdx], toUuid, (rng() - 0.5) * 2, "negative");
    // Additional untyped connections
    for (let c = 0; c < extraCount; c++) {
      const fromIdx = Math.floor(rng() * sourcePool.length);
      addSynapse(sourcePool[fromIdx], toUuid, (rng() - 0.5) * 2);
    }
  }

  // Layer 0: connect from inputs
  for (const uuid of layerUuids[0]) {
    const neuronDef = neurons.find((n) => n.uuid === uuid);
    if (neuronDef?.squash === "IF") {
      wireIfNeuron(uuid, inputUuids, 2 + Math.floor(rng() * 3));
    } else {
      // Each neuron in layer 0 gets 3-6 input connections
      const connCount = 3 + Math.floor(rng() * 4);
      for (let c = 0; c < connCount; c++) {
        const fromIdx = Math.floor(rng() * inputCount);
        addSynapse(inputUuids[fromIdx], uuid, (rng() - 0.5) * 2);
      }
    }
  }

  // Inter-layer connections (feedforward)
  for (let layer = 1; layer < layerWidths.length; layer++) {
    const prevLayer = layerUuids[layer - 1];
    const currLayer = layerUuids[layer];

    for (const toUuid of currLayer) {
      const neuronDef = neurons.find((n) => n.uuid === toUuid);
      if (neuronDef?.squash === "IF") {
        wireIfNeuron(toUuid, prevLayer, 5 + Math.floor(rng() * 10));
      } else {
        // Each neuron gets 15-30 connections from previous layer
        const connCount = 15 + Math.floor(rng() * 16);
        for (let c = 0; c < connCount; c++) {
          const fromIdx = Math.floor(rng() * prevLayer.length);
          addSynapse(prevLayer[fromIdx], toUuid, (rng() - 0.5) * 2);
        }
      }
    }

    // Skip connections: ~20% of neurons connect from layer-2
    if (layer >= 2) {
      const skipLayer = layerUuids[layer - 2];
      for (const toUuid of currLayer) {
        if (rng() < 0.2) {
          const skipCount = 1 + Math.floor(rng() * 3);
          for (let sc = 0; sc < skipCount; sc++) {
            const fromIdx = Math.floor(rng() * skipLayer.length);
            addSynapse(skipLayer[fromIdx], toUuid, (rng() - 0.5) * 1);
          }
        }
      }
    }
  }

  // Last hidden layer to outputs — ensure every last-layer neuron has an
  // outward connection (validation requires it for hidden neurons).
  const lastHidden = layerUuids[layerUuids.length - 1];
  for (const hiddenUuid of lastHidden) {
    const outIdx = Math.floor(rng() * outputCount);
    addSynapse(hiddenUuid, outputUuids[outIdx], (rng() - 0.5) * 0.5);
  }
  // Additional random connections from last layer to outputs
  for (const outUuid of outputUuids) {
    const connCount = 10 + Math.floor(rng() * 11);
    for (let c = 0; c < connCount; c++) {
      const fromIdx = Math.floor(rng() * lastHidden.length);
      addSynapse(lastHidden[fromIdx], outUuid, (rng() - 0.5) * 0.5);
    }
  }

  // Add some direct input-to-output skip connections (like residual paths)
  for (const outUuid of outputUuids) {
    const skipCount = 2 + Math.floor(rng() * 3);
    for (let c = 0; c < skipCount; c++) {
      const fromIdx = Math.floor(rng() * inputCount);
      addSynapse(inputUuids[fromIdx], outUuid, (rng() - 0.5) * 0.1);
    }
  }

  return {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  };
}

/**
 * Generate deterministic training data that exercises all outputs.
 */
function generateTrainingData(
  inputCount: number,
  outputCount: number,
  sampleCount: number,
  rng: () => number,
): DataRecordInterface[] {
  const data: DataRecordInterface[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const input = new Float32Array(inputCount);
    const output = new Float32Array(outputCount);
    for (let j = 0; j < inputCount; j++) {
      input[j] = (rng() - 0.5) * 2;
    }
    for (let j = 0; j < outputCount; j++) {
      // Simple target function: weighted combination of inputs
      let sum = 0;
      for (let k = 0; k < Math.min(5, inputCount); k++) {
        sum += input[k] * (rng() - 0.5);
      }
      output[j] = Math.tanh(sum);
    }
    data.push({ input, output });
  }
  return data;
}

/**
 * Calculate mean squared error for a creature on a data set.
 */
function calculateMSE(
  creature: Creature,
  dataSet: DataRecordInterface[],
): number {
  let errorSum = 0;
  for (const sample of dataSet) {
    const output = creature.activate(new Float32Array(sample.input));
    for (let i = 0; i < sample.output.length; i++) {
      const diff = output[i] - sample.output[i];
      errorSum += diff * diff;
    }
  }
  return errorSum / dataSet.length;
}

// ---------------------------------------------------------------------------
// Test 1: Production-scale creature generation and structure validation
// ---------------------------------------------------------------------------

Deno.test("production-scale: creature meets target dimensions", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);
  creature.validate();

  assertGreater(
    creature.neurons.length,
    1000,
    `Should have 1000+ neurons, got ${creature.neurons.length}`,
  );
  assertGreater(
    creature.synapses.length,
    18000,
    `Should have 18000+ synapses, got ${creature.synapses.length}`,
  );

  // Verify diverse squash functions are present
  const squashSet = new Set<string>();
  for (const neuron of creature.neurons) {
    if (neuron.squash) squashSet.add(neuron.squash);
  }

  // Should have at least 10 distinct squash functions
  assertGreater(
    squashSet.size,
    10,
    `Should have diverse squash functions, got ${squashSet.size}: ${
      [...squashSet].join(", ")
    }`,
  );

  // Should include aggregate functions
  const hasAggregate = [...squashSet].some((s) =>
    AGGREGATE_SQUASHES.includes(s)
  );
  assert(
    hasAggregate,
    "Should include aggregate squash functions (IF/MAXIMUM/MINIMUM)",
  );
});

// ---------------------------------------------------------------------------
// Test 2: Backpropagation convergence — error decreases over iterations
// ---------------------------------------------------------------------------

Deno.test("production-scale: backprop converges with normalised gradients", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);

  const dataRng = createSeededRng(123);
  const trainingData = generateTrainingData(10, 3, 50, dataRng);

  const initialError = calculateMSE(creature, trainingData);

  const results = train(creature, trainingData, {
    targetError: 0.01,
    iterations: 10,
    learningRate: 0.1,
    disableRandomSamples: true,
    generations: 1,
    maximumBiasAdjustmentScale: 1,
    maximumWeightAdjustmentScale: 1,
    normaliseGradients: true,
    sparseRatio: 1,
  });

  // Error should decrease (convergence)
  assertLess(
    results.error,
    initialError,
    `Training error should decrease: initial=${initialError.toFixed(6)}, ` +
      `final=${results.error.toFixed(6)}`,
  );

  // Verify the creature is still valid after training
  creature.validate();

  // Verify no NaN/Infinity in weights and biases
  for (const synapse of creature.synapses) {
    assert(
      Number.isFinite(synapse.weight),
      `Synapse weight must be finite after training, got ${synapse.weight}`,
    );
  }
  for (const neuron of creature.neurons) {
    if (neuron.type !== "input" && neuron.type !== "constant") {
      assert(
        Number.isFinite(neuron.bias),
        `Neuron bias must be finite after training, got ${neuron.bias}`,
      );
    }
  }

  // Verify activations produce finite output
  for (const sample of trainingData.slice(0, 5)) {
    const output = creature.activate(new Float32Array(sample.input));
    for (let i = 0; i < output.length; i++) {
      assert(
        Number.isFinite(output[i]),
        `Output must be finite after training, got ${output[i]}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Test 3: Convergence comparison — normaliseGradients true vs false
// ---------------------------------------------------------------------------

Deno.test("production-scale: normalised vs unnormalised gradient convergence comparison", () => {
  const dataRng = createSeededRng(123);
  const trainingData = generateTrainingData(10, 3, 50, dataRng);

  const commonOptions = {
    targetError: 0.01,
    iterations: 8,
    learningRate: 0.1,
    disableRandomSamples: true,
    generations: 1,
    maximumBiasAdjustmentScale: 1,
    maximumWeightAdjustmentScale: 1,
    sparseRatio: 1,
  };

  // Train with normaliseGradients: false (old behaviour)
  const rngA = createSeededRng(42);
  const jsonA = generateProductionCreature(10, 3, rngA);
  const creatureA = Creature.fromJSON(jsonA);
  const initialErrorA = calculateMSE(creatureA, trainingData);

  const resultsOld = train(creatureA, trainingData, {
    ...commonOptions,
    normaliseGradients: false,
  });

  // Train with normaliseGradients: true (new behaviour)
  const rngB = createSeededRng(42);
  const jsonB = generateProductionCreature(10, 3, rngB);
  const creatureB = Creature.fromJSON(jsonB);
  const initialErrorB = calculateMSE(creatureB, trainingData);

  const resultsNew = train(creatureB, trainingData, {
    ...commonOptions,
    normaliseGradients: true,
  });

  // Both should start from the same initial error (same seed)
  const initialDiff = Math.abs(initialErrorA - initialErrorB);
  assertLess(
    initialDiff,
    0.001,
    `Initial errors should match (same seed): A=${initialErrorA}, B=${initialErrorB}`,
  );

  // Both should converge (error should decrease)
  assertLess(
    resultsOld.error,
    initialErrorA,
    `Old config should converge: initial=${initialErrorA}, final=${resultsOld.error}`,
  );
  assertLess(
    resultsNew.error,
    initialErrorB,
    `New config should converge: initial=${initialErrorB}, final=${resultsNew.error}`,
  );

  // Both creatures should remain valid
  creatureA.validate();
  creatureB.validate();

  // Document the comparison (logged for diagnostics, not asserted)
  const reductionOld = 1 - (resultsOld.error / initialErrorA);
  const reductionNew = 1 - (resultsNew.error / initialErrorB);
  console.log(
    `Convergence comparison:`,
    `\n  Old (normaliseGradients=false): error ${initialErrorA.toFixed(4)} → ${
      resultsOld.error.toFixed(4)
    } (${(reductionOld * 100).toFixed(1)}% reduction)`,
    `\n  New (normaliseGradients=true):  error ${initialErrorB.toFixed(4)} → ${
      resultsNew.error.toFixed(4)
    } (${(reductionNew * 100).toFixed(1)}% reduction)`,
  );
});

// ---------------------------------------------------------------------------
// Test 4: No non-finite values during multi-iteration training
// ---------------------------------------------------------------------------

Deno.test("production-scale: weights and biases remain finite across iterations", () => {
  const rng = createSeededRng(42);
  const json = generateProductionCreature(10, 3, rng);
  const creature = Creature.fromJSON(json);

  const dataRng = createSeededRng(456);
  const trainingData = generateTrainingData(10, 3, 30, dataRng);

  // Run 5 single-iteration training passes, checking finiteness each time
  for (let iteration = 0; iteration < 5; iteration++) {
    train(creature, trainingData, {
      targetError: 0.01,
      iterations: 1,
      learningRate: 0.1,
      disableRandomSamples: true,
      generations: iteration,
      maximumBiasAdjustmentScale: 1,
      maximumWeightAdjustmentScale: 1,
      normaliseGradients: true,
      sparseRatio: 1,
    });

    // Check all weights are finite
    for (const synapse of creature.synapses) {
      assert(
        Number.isFinite(synapse.weight),
        `Synapse weight non-finite at iteration ${iteration}: ${synapse.weight}`,
      );
    }

    // Check all biases are finite
    for (const neuron of creature.neurons) {
      if (neuron.type !== "input" && neuron.type !== "constant") {
        assert(
          Number.isFinite(neuron.bias),
          `Neuron bias non-finite at iteration ${iteration}: ${neuron.bias}`,
        );
      }
    }

    // Check activations produce finite output
    const sample = trainingData[iteration % trainingData.length];
    const output = creature.activate(new Float32Array(sample.input));
    for (let i = 0; i < output.length; i++) {
      assert(
        Number.isFinite(output[i]),
        `Output non-finite at iteration ${iteration}: ${output[i]}`,
      );
    }
  }
});
