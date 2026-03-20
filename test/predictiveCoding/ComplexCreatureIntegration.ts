/**
 * Integration tests for Predictive Coding with complex creatures.
 *
 * Issue #1914: Validates that PC training works correctly on creatures
 * with 30+ hidden neurons, mixed activation functions, multiple layers
 * of depth, and both forward-only and recurrent topologies.
 *
 * These tests exercise production-representative creature topologies
 * to ensure PC inference converges and training produces measurable
 * improvement beyond the trivial XOR problems tested elsewhere.
 */

import { assert, assertEquals, assertGreater, assertLess } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "../../src/architecture/DataSet.ts";
import { trainDir } from "../../src/architecture/Training.ts";
import { Costs } from "../../src/Costs.ts";
import { DEFAULT_PREDICTIVE_CODING_CONFIG } from "../../src/config/PredictiveCodingConfig.ts";
import { trainWithPredictiveCoding } from "../../src/predictiveCoding/PredictiveCodingTrainer.ts";
import { runInference } from "../../src/predictiveCoding/PredictiveCodingInference.ts";
import type { TrainOptions } from "../../src/config/TrainOptions.ts";
import { getTag } from "@stsoftware/tags/mod";
import type { CreatureExport } from "../../src/architecture/CreatureInterfaces.ts";

/**
 * Builds a complex creature with 30+ hidden neurons across multiple layers,
 * using mixed activation functions. This mirrors production-scale topology
 * with a rich connectivity pattern.
 *
 * Topology: 4 inputs → 12 hidden (layer 1) → 10 hidden (layer 2)
 *         → 8 hidden (layer 3) → 6 hidden (layer 4) → 2 outputs
 * Total hidden neurons: 36
 */
function makeComplexCreature(): Creature {
  const squashFunctions = [
    "TANH",
    "LOGISTIC",
    "ReLU",
    "IDENTITY",
    "SELU",
    "Swish",
  ];

  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Layer structure: 12, 10, 8, 6 hidden neurons across 4 layers.
  const layerSizes = [12, 10, 8, 6];
  const inputCount = 4;
  const outputCount = 2;

  // Track UUIDs per layer for connection building.
  const layerUUIDs: string[][] = [];

  // Input UUIDs.
  const inputUUIDs: string[] = [];
  for (let i = 0; i < inputCount; i++) {
    inputUUIDs.push(`input-${i}`);
  }

  // Build hidden neurons layer by layer with mixed activations.
  let neuronIdx = 0;
  for (let layer = 0; layer < layerSizes.length; layer++) {
    const layerNodes: string[] = [];
    for (let n = 0; n < layerSizes[layer]; n++) {
      const uuid = `hidden-L${layer}-N${n}`;
      const squash = squashFunctions[neuronIdx % squashFunctions.length];
      const bias = (neuronIdx % 5 - 2) * 0.1; // Varied biases: -0.2 to 0.2
      neurons.push({ type: "hidden", uuid, squash, bias });
      layerNodes.push(uuid);
      neuronIdx++;
    }
    layerUUIDs.push(layerNodes);
  }

  // Output neurons.
  const outputUUIDs: string[] = [];
  for (let o = 0; o < outputCount; o++) {
    const uuid = `output-${o}`;
    neurons.push({ type: "output", uuid, squash: "IDENTITY", bias: 0 });
    outputUUIDs.push(uuid);
  }

  // Build synapses: fully-connected between adjacent layers.
  // Input → Layer 0
  for (const fromUUID of inputUUIDs) {
    for (const toUUID of layerUUIDs[0]) {
      const weight = Math.sin(synapses.length * 1.7) * 0.3;
      synapses.push({ fromUUID, toUUID, weight });
    }
  }

  // Layer[i] → Layer[i+1]
  for (let layer = 0; layer < layerSizes.length - 1; layer++) {
    for (const fromUUID of layerUUIDs[layer]) {
      for (const toUUID of layerUUIDs[layer + 1]) {
        const weight = Math.sin(synapses.length * 2.3) * 0.2;
        synapses.push({ fromUUID, toUUID, weight });
      }
    }
  }

  // Last hidden layer → Output
  for (const fromUUID of layerUUIDs[layerSizes.length - 1]) {
    for (const toUUID of outputUUIDs) {
      const weight = Math.sin(synapses.length * 1.3) * 0.25;
      synapses.push({ fromUUID, toUUID, weight });
    }
  }

  // Add some skip connections (layer 0 → layer 2) for richer connectivity.
  for (let i = 0; i < 4; i++) {
    synapses.push({
      fromUUID: layerUUIDs[0][i],
      toUUID: layerUUIDs[2][i % layerSizes[2]],
      weight: Math.sin(synapses.length * 0.7) * 0.15,
    });
  }

  const exported: CreatureExport = {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  };

  const creature = Creature.fromJSON(exported);
  creature.validate();
  return creature;
}

/**
 * Generates a multi-dimensional regression dataset.
 *
 * Each sample maps 4 inputs to 2 outputs using a nonlinear function,
 * providing a meaningful learning task for complex creatures.
 */
function makeRegressionDataset(
  sampleCount: number,
): DataRecordInterface[] {
  const data: DataRecordInterface[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    const x0 = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
    const x1 = Math.cos(t * Math.PI * 2) * 0.5 + 0.5;
    const x2 = t;
    const x3 = 1 - t;

    // Nonlinear target functions.
    const y0 = (x0 * x1 + x2 * 0.3) * 0.8;
    const y1 = (x1 * x3 + x0 * 0.2) * 0.6;

    data.push({
      input: new Float32Array([x0, x1, x2, x3]),
      output: new Float32Array([y0, y1]),
    });
  }
  return data;
}

// ---------------------------------------------------------------------------
// Test: Complex creature with 30+ hidden neurons
// ---------------------------------------------------------------------------

Deno.test("PC inference converges on complex creature with 36 hidden neurons", () => {
  const creature = makeComplexCreature();

  // Verify we have 30+ hidden neurons as required.
  const hiddenCount = creature.neurons.filter((n) => n.type === "hidden")
    .length;
  assertGreater(
    hiddenCount,
    30,
    `Expected 30+ hidden neurons, got ${hiddenCount}`,
  );

  const input = new Float32Array([0.3, 0.7, 0.5, 0.2]);
  const targets = new Float64Array([0.4, 0.6]);

  // Run forward activation to initialise neuron states.
  creature.activate(input);

  const pcConfig = {
    ...DEFAULT_PREDICTIVE_CODING_CONFIG,
    enabled: true,
    inferenceSteps: 50,
    inferenceRate: 0.02,
    energyThreshold: 1e-6,
  };

  const result = runInference(creature, input, pcConfig, targets);

  // Energy should be finite and non-negative.
  assert(Number.isFinite(result.finalEnergy), "Final energy should be finite");
  assert(result.finalEnergy >= 0, "Energy should be non-negative");

  // Energy history should show monotonic decrease (within tolerance).
  // PC inference should reduce energy over iterations.
  const history = result.energyHistory;
  assertGreater(history.length, 1, "Should have multiple energy readings");

  // Verify general energy decrease: final energy should be less than
  // or equal to initial energy.
  assertLess(
    history[history.length - 1],
    history[0] + 1e-10,
    "Energy should not increase overall",
  );

  // Verify stepsUsed is within bounds.
  assertGreater(result.stepsUsed, 0, "Should use at least 1 inference step");
  assertLess(
    result.stepsUsed,
    pcConfig.inferenceSteps + 1,
    "Should not exceed configured steps",
  );
});

// ---------------------------------------------------------------------------
// Test: PC trace fields populated on hidden neurons
// ---------------------------------------------------------------------------

Deno.test("PC inference populates trace fields on hidden neurons of complex creature", () => {
  const creature = makeComplexCreature();

  const input = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  const targets = new Float64Array([0.3, 0.7]);

  creature.activate(input);

  const pcConfig = {
    ...DEFAULT_PREDICTIVE_CODING_CONFIG,
    enabled: true,
    inferenceSteps: 30,
    inferenceRate: 0.02,
  };

  const result = runInference(creature, input, pcConfig, targets);

  // Verify trace fields on hidden neurons.
  let hiddenWithTrace = 0;
  let hiddenWithPrediction = 0;
  let hiddenWithError = 0;
  let hiddenWithLatent = 0;

  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    if (neuron.type !== "hidden") continue;

    const state = creature.state.node(i);

    if (state.prediction !== undefined) {
      assert(
        Number.isFinite(state.prediction),
        `Prediction for hidden neuron ${i} should be finite`,
      );
      hiddenWithPrediction++;
    }

    if (state.predictionError !== undefined) {
      assert(
        Number.isFinite(state.predictionError),
        `Prediction error for hidden neuron ${i} should be finite`,
      );
      hiddenWithError++;
    }

    if (state.latentValue !== undefined) {
      assert(
        Number.isFinite(state.latentValue),
        `Latent value for hidden neuron ${i} should be finite`,
      );
      hiddenWithLatent++;
    }

    if (
      state.prediction !== undefined &&
      state.predictionError !== undefined &&
      state.latentValue !== undefined
    ) {
      hiddenWithTrace++;
    }
  }

  // All hidden neurons should have PC trace fields populated
  // since runInference stores them for all non-input neurons.
  const totalHidden = creature.neurons.filter((n) => n.type === "hidden")
    .length;
  assertGreater(totalHidden, 0, "Should have hidden neurons");
  assertGreater(
    hiddenWithTrace,
    0,
    "At least some hidden neurons should have trace fields",
  );

  // The inference result predictionErrors map should cover non-input neurons.
  assertGreater(
    result.predictionErrors.size,
    0,
    "Should have prediction errors for non-input neurons",
  );

  // Verify the result has valid prediction, error, and latent fields.
  for (const [idx, nodeState] of result.predictionErrors) {
    assert(
      Number.isFinite(nodeState.prediction),
      `Prediction for neuron ${idx} should be finite`,
    );
    assert(
      Number.isFinite(nodeState.error),
      `Error for neuron ${idx} should be finite`,
    );
    assert(
      Number.isFinite(nodeState.latent),
      `Latent for neuron ${idx} should be finite`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test: PC training produces non-zero gradients on complex creature
// ---------------------------------------------------------------------------

Deno.test("PC training produces non-zero weight gradients on complex creature", () => {
  const creature = makeComplexCreature();

  const dataSet = makeRegressionDataset(8);
  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    // Capture initial weights.
    const initialWeights = creature.synapses.map((s) => s.weight);

    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
      inferenceSteps: 30,
      inferenceRate: 0.02,
      learningRate: 0.005,
    };

    const result = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 5, targetError: 0 },
    );

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.changed, "Training should have changed weights");

    // Verify at least some synapses had their weights modified.
    let changedCount = 0;
    for (let s = 0; s < creature.synapses.length; s++) {
      if (Math.abs(creature.synapses[s].weight - initialWeights[s]) > 1e-12) {
        changedCount++;
      }
    }
    assertGreater(
      changedCount,
      0,
      "At least some synapse weights should have changed",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test: Error decreases across PC training iterations
// ---------------------------------------------------------------------------

Deno.test("PC training reduces error across iterations on complex creature", () => {
  const creature = makeComplexCreature();

  const dataSet = makeRegressionDataset(12);
  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
      inferenceSteps: 30,
      inferenceRate: 0.02,
      learningRate: 0.005,
    };

    // Measure initial error (zero learning rate = no weight updates).
    const baselineCreature = Creature.fromJSON(creature.exportJSON());
    const initialResult = trainWithPredictiveCoding(
      baselineCreature,
      [dataSetDir + "/0.bin"],
      { ...pcConfig, learningRate: 0 },
      Costs.find("MSE"),
      { iterations: 1, targetError: 0 },
    );

    // Train with PC for multiple iterations.
    const trainedResult = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 30, targetError: 0.001 },
    );

    assert(
      Number.isFinite(initialResult.error),
      "Initial error should be finite",
    );
    assert(
      Number.isFinite(trainedResult.error),
      "Trained error should be finite",
    );

    // Error should decrease after training.
    assertLess(
      trainedResult.error,
      initialResult.error,
      "Error should decrease after PC training iterations",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test: trainDir with PC on complex creature produces valid trace tags
// ---------------------------------------------------------------------------

Deno.test("trainDir with PC on complex creature produces valid trace tags", () => {
  const creature = makeComplexCreature();

  const dataSet = makeRegressionDataset(8);
  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const options: TrainOptions = {
      iterations: 5,
      targetError: 0.001,
      disableRandomSamples: true,
      predictiveCoding: {
        ...DEFAULT_PREDICTIVE_CODING_CONFIG,
        enabled: true,
        inferenceSteps: 30,
        inferenceRate: 0.02,
        learningRate: 0.005,
      },
    };

    const result = trainDir(creature, dataSetDir, options, Costs.find("MSE"));

    assert(result.trace, "Should return a trace");
    assert(result.ID, "Should return an ID");
    assert(Number.isFinite(result.error), "Error should be finite");

    // Verify PC-specific trace tags.
    const approach = getTag(result.trace, "approach");
    assertEquals(approach, "predictive-coding", "Should have PC approach tag");

    const energy = getTag(result.trace, "pc-energy");
    assert(energy !== null, "Should have pc-energy tag");

    const steps = getTag(result.trace, "pc-inference-steps");
    assert(steps !== null, "Should have pc-inference-steps tag");

    const changed = getTag(result.trace, "pc-changed");
    assert(changed !== null, "Should have pc-changed tag");
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test: Forward-only complex creature with mixed activations
// ---------------------------------------------------------------------------

Deno.test("PC training works on forward-only complex creature with mixed activations", () => {
  // Build a forward-only creature with 32 hidden neurons across 3 layers.
  const creature = new Creature(4, 2, {
    layers: [
      { count: 14, squash: "TANH" },
      { count: 10, squash: "LOGISTIC" },
      { count: 8, squash: "ReLU" },
    ],
    outputLayer: { squash: "IDENTITY" },
  });

  const hiddenCount = creature.neurons.filter((n) => n.type === "hidden")
    .length;
  assertGreater(
    hiddenCount,
    30,
    `Expected 30+ hidden neurons, got ${hiddenCount}`,
  );

  const dataSet = makeRegressionDataset(8);
  const dataSetDir = makeDataDir(dataSet, dataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
      inferenceSteps: 40,
      inferenceRate: 0.02,
      learningRate: 0.005,
    };

    const result = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 10, targetError: 0.001 },
    );

    assert(Number.isFinite(result.error), "Error should be finite");
    assert(result.error >= 0, "Error should be non-negative");
    assert(result.changed, "Training should modify weights");
    assert(
      Number.isFinite(result.averageEnergy),
      "Average energy should be finite",
    );
    assertGreater(
      result.averageInferenceSteps,
      0,
      "Should use at least 1 inference step",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test: Production-representative topology (GRQ-cluster-scale creature)
// ---------------------------------------------------------------------------

Deno.test("PC training improves on production-representative GRQ-cluster topology", () => {
  // Build a creature representative of the production GRQ-cluster network.
  // Production creature has ~90+ neurons. We create a scaled version
  // with 50+ hidden neurons across 5 layers with diverse connectivity.
  const squashOptions = [
    "TANH",
    "LOGISTIC",
    "ReLU",
    "SELU",
    "Swish",
    "IDENTITY",
    "Softplus",
    "LeakyReLU",
  ];

  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];
  const inputCount = 6;
  const outputCount = 3;

  // 5 hidden layers: 15, 12, 10, 8, 6 = 51 hidden neurons.
  const layerSizes = [15, 12, 10, 8, 6];
  const layerUUIDs: string[][] = [];

  let nIdx = 0;
  for (let layer = 0; layer < layerSizes.length; layer++) {
    const layerNodes: string[] = [];
    for (let n = 0; n < layerSizes[layer]; n++) {
      const uuid = `h-L${layer}-N${n}`;
      const squash = squashOptions[nIdx % squashOptions.length];
      const bias = Math.sin(nIdx * 1.1) * 0.15;
      neurons.push({ type: "hidden", uuid, squash, bias });
      layerNodes.push(uuid);
      nIdx++;
    }
    layerUUIDs.push(layerNodes);
  }

  // Output neurons.
  for (let o = 0; o < outputCount; o++) {
    neurons.push({
      type: "output",
      uuid: `output-${o}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  // Input UUIDs.
  const inputUUIDs = Array.from({ length: inputCount }, (_, i) => `input-${i}`);
  const outputUUIDs = Array.from(
    { length: outputCount },
    (_, o) => `output-${o}`,
  );

  // Connect inputs → layer 0 (sparse: each input to ~half the layer).
  for (let i = 0; i < inputCount; i++) {
    for (let n = 0; n < layerSizes[0]; n++) {
      if ((i + n) % 2 === 0) {
        synapses.push({
          fromUUID: inputUUIDs[i],
          toUUID: layerUUIDs[0][n],
          weight: Math.sin(synapses.length * 1.7) * 0.3,
        });
      }
    }
  }

  // Connect adjacent layers (sparse: ~60% connectivity).
  for (let layer = 0; layer < layerSizes.length - 1; layer++) {
    for (let f = 0; f < layerSizes[layer]; f++) {
      for (let t = 0; t < layerSizes[layer + 1]; t++) {
        if ((f + t + layer) % 3 !== 0) {
          synapses.push({
            fromUUID: layerUUIDs[layer][f],
            toUUID: layerUUIDs[layer + 1][t],
            weight: Math.sin(synapses.length * 2.1) * 0.2,
          });
        }
      }
    }
  }

  // Skip connections: layer 0 → layer 2, layer 1 → layer 3.
  for (let i = 0; i < Math.min(layerSizes[0], layerSizes[2]); i += 2) {
    synapses.push({
      fromUUID: layerUUIDs[0][i],
      toUUID: layerUUIDs[2][i % layerSizes[2]],
      weight: Math.sin(synapses.length * 0.9) * 0.1,
    });
  }
  for (let i = 0; i < Math.min(layerSizes[1], layerSizes[3]); i += 2) {
    synapses.push({
      fromUUID: layerUUIDs[1][i],
      toUUID: layerUUIDs[3][i % layerSizes[3]],
      weight: Math.sin(synapses.length * 0.8) * 0.1,
    });
  }

  // Last hidden layer → outputs.
  for (const fromUUID of layerUUIDs[layerSizes.length - 1]) {
    for (const toUUID of outputUUIDs) {
      synapses.push({
        fromUUID,
        toUUID,
        weight: Math.sin(synapses.length * 1.5) * 0.25,
      });
    }
  }

  const creature = Creature.fromJSON({
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  });
  creature.validate();

  const hiddenCount = creature.neurons.filter((n) => n.type === "hidden")
    .length;
  assertGreater(
    hiddenCount,
    50,
    `Expected 50+ hidden neurons for production-representative topology, got ${hiddenCount}`,
  );

  // Generate a more complex dataset for the larger creature.
  const dataSet = makeRegressionDataset(16);
  // Map to 6 inputs and 3 outputs.
  const mappedDataSet: DataRecordInterface[] = dataSet.map((d) => ({
    input: new Float32Array([
      d.input[0],
      d.input[1],
      d.input[2],
      d.input[3],
      d.input[0] * d.input[1],
      d.input[2] * d.input[3],
    ]),
    output: new Float32Array([
      d.output[0],
      d.output[1],
      (d.output[0] + d.output[1]) / 2,
    ]),
  }));

  const dataSetDir = makeDataDir(mappedDataSet, mappedDataSet.length, {
    input: creature.input,
    output: creature.output,
  });

  try {
    const pcConfig = {
      ...DEFAULT_PREDICTIVE_CODING_CONFIG,
      enabled: true,
      inferenceSteps: 40,
      inferenceRate: 0.02,
      learningRate: 0.003,
    };

    // Measure baseline error.
    const baselineCreature = Creature.fromJSON(creature.exportJSON());
    const baseline = trainWithPredictiveCoding(
      baselineCreature,
      [dataSetDir + "/0.bin"],
      { ...pcConfig, learningRate: 0 },
      Costs.find("MSE"),
      { iterations: 1, targetError: 0 },
    );

    // Train.
    const result = trainWithPredictiveCoding(
      creature,
      [dataSetDir + "/0.bin"],
      pcConfig,
      Costs.find("MSE"),
      { iterations: 30, targetError: 0.001 },
    );

    assert(Number.isFinite(baseline.error), "Baseline error should be finite");
    assert(Number.isFinite(result.error), "Trained error should be finite");
    assert(result.changed, "Training should have changed weights");

    // PC training should produce measurable improvement.
    assertLess(
      result.error,
      baseline.error,
      "PC training should reduce error on production-representative topology",
    );
  } finally {
    Deno.removeSync(dataSetDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Test: Energy convergence during inference on complex creature
// ---------------------------------------------------------------------------

Deno.test("PC energy converges monotonically during inference on complex creature", () => {
  const creature = makeComplexCreature();

  const input = new Float32Array([0.2, 0.8, 0.4, 0.6]);
  const targets = new Float64Array([0.5, 0.3]);

  creature.activate(input);

  const pcConfig = {
    ...DEFAULT_PREDICTIVE_CODING_CONFIG,
    enabled: true,
    inferenceSteps: 50,
    inferenceRate: 0.01, // Conservative rate for monotonic convergence.
    energyThreshold: 1e-8,
  };

  const result = runInference(creature, input, pcConfig, targets);

  // Energy should generally decrease. Allow small tolerance for
  // numerical noise but verify overall convergence.
  const history = result.energyHistory;
  assertGreater(history.length, 2, "Should have multiple energy readings");

  // Count non-decreasing steps (allowing small tolerance).
  let nonDecreasingSteps = 0;
  const tolerance = 1e-10;
  for (let i = 1; i < history.length; i++) {
    if (history[i] > history[i - 1] + tolerance) {
      nonDecreasingSteps++;
    }
  }

  // Allow at most a few non-monotonic steps due to numerical noise,
  // but the majority should be decreasing.
  const maxAllowedNonDecreasing = Math.ceil(history.length * 0.2);
  assertLess(
    nonDecreasingSteps,
    maxAllowedNonDecreasing,
    `Too many non-decreasing energy steps: ${nonDecreasingSteps} out of ${
      history.length - 1
    }`,
  );

  // Overall energy should decrease.
  assertLess(
    history[history.length - 1],
    history[0] + tolerance,
    "Final energy should not exceed initial energy",
  );
});
