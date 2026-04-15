/**
 * ProductionScaleCreature.ts — Shared utilities for generating
 * production-scale creatures for testing and benchmarking.
 *
 * Issue #1875, #1924 — Extracted from ProductionScale.ts so that
 * both correctness tests and performance benchmarks can reuse the
 * same deterministic creature generation logic.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import type { Creature } from "@creature";

/**
 * Deterministic seeded PRNG (mulberry32) for reproducible creature generation.
 */
export function createSeededRng(seed: number): () => number {
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
export const SQUASH_CATEGORIES = {
  sigmoid: ["LOGISTIC", "BIPOLAR_SIGMOID", "LogSigmoid"],
  tanh: ["TANH", "HARD_TANH"],
  relu: ["ReLU", "LeakyReLU", "ELU", "SELU", "ReLU6"],
  smooth: ["Mish", "Swish", "GELU", "Softplus", "SOFTSIGN"],
  identity: ["IDENTITY"],
  trigonometric: ["SINE", "Cosine", "ArcTan", "TAN"],
  other: ["GAUSSIAN", "BENT_IDENTITY", "STEP", "BIPOLAR", "Exponential"],
};

export const ALL_SQUASHES = Object.values(SQUASH_CATEGORIES).flat();

/** Aggregate squash functions requiring special connectivity (3+ inputs). */
export const AGGREGATE_SQUASHES = ["IF", "MAXIMUM", "MINIMUM"];

/**
 * Scale presets for creature generation.
 *
 * - `"default"`: ~1,000 neurons, ~18,000 synapses (original test scale).
 * - `"grq-cluster"`: ~1,500 neurons, ~20,000 synapses (GRQ production scale,
 *   matching dimensions from `performance.csv`). Issue #2306.
 */
export interface CreatureScaleOptions {
  /**
   * Predefined scale preset. Defaults to `"default"`.
   * `"grq-cluster"` targets ~1,500 neurons and ~20,000 synapses.
   */
  scale?: "default" | "grq-cluster";
}

/** Internal configuration per scale preset. */
interface ScaleConfig {
  layers: number[];
  /** Min inter-layer connections per neuron. */
  interLayerMin: number;
  /** Max inter-layer connections per neuron (exclusive offset from min). */
  interLayerRange: number;
}

const SCALE_CONFIGS: Record<string, ScaleConfig> = {
  "default": {
    layers: [180, 220, 200, 160, 140, 100, 60],
    interLayerMin: 15,
    interLayerRange: 16,
  },
  "grq-cluster": {
    layers: [250, 270, 240, 210, 170, 140, 100, 70, 40],
    interLayerMin: 10,
    interLayerRange: 12,
  },
};

/**
 * Generate a production-scale creature deterministically.
 *
 * Target depends on `options.scale`:
 * - `"default"`: ~1,000+ neurons, ~18,000+ synapses
 * - `"grq-cluster"`: ~1,500 neurons, ~20,000 synapses (issue #2306)
 *
 * Uses diverse squash functions, multiple layers, aggregate neurons,
 * and skip connections for realistic topology depth.
 */
export function generateProductionCreature(
  inputCount: number,
  outputCount: number,
  rng: () => number,
  options?: CreatureScaleOptions,
): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  // Layer configuration: varying widths for depth; preset selects scale
  const scaleName = options?.scale ?? "default";
  const scaleConfig = SCALE_CONFIGS[scaleName] ?? SCALE_CONFIGS["default"];
  const layerWidths = scaleConfig.layers;
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
        // Each neuron gets connections from previous layer (scale-dependent)
        const connCount = scaleConfig.interLayerMin +
          Math.floor(rng() * scaleConfig.interLayerRange);
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

  // Log scale info (useful for debugging)
  void neuronCounter;

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
export function generateTrainingData(
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
export function calculateMSE(
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
