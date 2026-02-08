import { Creature } from "../Creature.ts";
import { createBackPropagationConfig } from "../propagate/BackPropagation.ts";
import { SparseConfig } from "../propagate/sparse/SparseConfig.ts";
import { calculateBias } from "../propagate/Bias.ts";
import { calculateWeight } from "../propagate/Weight.ts";

/**
 * Represents a gradient-informed hint for a single parameter (bias or weight).
 *
 * - `direction`: The sign of the gradient (-1, 0, or 1), indicating which
 *   direction backpropagation suggests moving the parameter.
 * - `magnitude`: A normalised value in [0, 1] indicating how strongly the
 *   gradient suggests the change. Higher values mean a larger suggested change
 *   relative to the parameter's current value.
 */
export interface GradientHint {
  direction: -1 | 0 | 1;
  magnitude: number;
}

/**
 * A collection of gradient hints for all biases and weights in a creature.
 *
 * - `biases`: Map from neuron UUID to its gradient hint.
 * - `weights`: Map from "fromUUID->toUUID" key to its gradient hint.
 */
export interface GradientHintMap {
  biases: Map<string, GradientHint>;
  weights: Map<string, GradientHint>;
}

/**
 * Runs a single backpropagation pass on the given creature with the provided
 * training data, then extracts gradient direction and magnitude hints for each
 * bias and weight.
 *
 * This does not modify the creature — it creates a clone, runs backprop on the
 * clone, and reads the accumulated target values to determine what direction
 * backpropagation would adjust each parameter.
 *
 * @param creature - The creature to collect gradient hints for.
 * @param trainingData - Array of input/output pairs to run backprop on.
 * @returns A GradientHintMap with hints for biases and weights.
 */
export function collectGradientHints(
  creature: Creature,
  trainingData: { input: number[]; output: number[] }[],
): GradientHintMap {
  const result: GradientHintMap = {
    biases: new Map(),
    weights: new Map(),
  };

  if (trainingData.length === 0) {
    return result;
  }

  // Clone the creature so we don't modify the original
  const clone = Creature.fromJSON(creature.exportJSON());

  // Create a deterministic backprop config for gradient collection
  const config = createBackPropagationConfig({
    generations: 1,
    learningRate: 1.0,
    disableRandomSamples: true,
    plankConstant: 0.000_000_1,
    maximumBiasAdjustmentScale: 10,
    maximumWeightAdjustmentScale: 10,
    limitBiasScale: 10_000,
    limitWeightScale: 100_000,
    batchSize: trainingData.length,
    sparseRatio: 1,
    learningRateStrategy: "fixed",
    initialLearningRate: 1.0,
    learningRateDecay: 1.0,
    trainingMutationRate: 0, // No mutations during gradient collection
    disableBiasAdjustment: false,
    disableWeightAdjustment: false,
  });

  const sparseConfig = new SparseConfig(clone.exportJSON(), config);

  // Run backprop on all training samples
  for (const sample of trainingData) {
    const inputArray = new Float32Array(sample.input);
    const outputArray = new Float32Array(sample.output);

    clone.activateAndTrace(inputArray, true, sparseConfig);
    clone.propagate(outputArray, config, sparseConfig);
  }

  // Extract gradient hints from accumulated state
  const state = clone.state;

  // Collect bias hints for non-input neurons
  for (let i = clone.input; i < clone.neurons.length; i++) {
    const neuron = clone.neurons[i];
    if (neuron.type === "constant") continue;

    const targetBias = calculateBias(neuron, config);
    const currentBias = neuron.bias;
    const diff = targetBias - currentBias;

    if (Math.abs(diff) < config.plankConstant) {
      continue;
    }

    const direction = Math.sign(diff) as -1 | 0 | 1;
    // Normalise magnitude: |diff| / (1 + |diff|) to keep it in [0, 1)
    const magnitude = Math.abs(diff) / (1 + Math.abs(diff));

    result.biases.set(neuron.uuid, { direction, magnitude });
  }

  // Collect weight hints for all synapses
  for (const synapse of clone.synapses) {
    const cs = state.connection(synapse.from, synapse.to);
    if (cs.count === 0) continue;

    const targetWeight = calculateWeight(cs, synapse, config);
    const currentWeight = synapse.weight;
    const diff = targetWeight - currentWeight;

    if (Math.abs(diff) < config.plankConstant) {
      continue;
    }

    const direction = Math.sign(diff) as -1 | 0 | 1;
    const magnitude = Math.abs(diff) / (1 + Math.abs(diff));

    const fromNeuron = clone.neurons[synapse.from];
    const toNeuron = clone.neurons[synapse.to];
    const key = `${fromNeuron.uuid}->${toNeuron.uuid}`;

    result.weights.set(key, { direction, magnitude });
  }

  return result;
}
