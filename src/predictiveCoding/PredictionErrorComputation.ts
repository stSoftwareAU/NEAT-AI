/**
 * Prediction error computation for Predictive Coding inference.
 *
 * Issue #1554: Computes per-neuron prediction errors and total energy
 * for the PC inference loop. The prediction for each neuron is the
 * weighted sum of incoming activations passed through the neuron's
 * squash function.
 *
 * Prediction: x̂(i) = f(bias_i + Σ_j w_ji · x(j))
 * Error:      ε(i) = x(i) - x̂(i)
 * Energy:     ℒ = ½ Σ_i ε(i)²
 */

import type { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";

/**
 * Result of computing prediction errors across the network.
 */
export interface PredictionErrorResult {
  /** Per-neuron prediction errors indexed by neuron position. */
  readonly errors: Float64Array;

  /** Per-neuron predictions indexed by neuron position. */
  readonly predictions: Float64Array;

  /** Total prediction error energy: ½ Σ ε(i)². */
  readonly energy: number;
}

/**
 * Computes the top-down prediction for a single neuron.
 *
 * The prediction is calculated as the squash of the weighted sum
 * of all inward connections' source activations plus the neuron's bias.
 *
 * @param creature The creature containing the network topology.
 * @param neuronIndex Index of the neuron to compute prediction for.
 * @param activations Current activation values for all neurons.
 * @returns The predicted activation value.
 */
export function computePrediction(
  creature: Creature,
  neuronIndex: number,
  activations: Float64Array,
): number {
  const neuron = creature.neurons[neuronIndex];
  const inward = creature.inwardConnections(neuronIndex);

  // Weighted sum of incoming activations + bias
  let weightedSum = neuron.bias;
  for (let i = 0; i < inward.length; i++) {
    const synapse = inward[i];
    weightedSum += synapse.weight * activations[synapse.from];
  }

  // Apply squash function
  const squashName = neuron.squash;
  if (!squashName) {
    return weightedSum;
  }

  const activation = Activations.find(squashName);
  if (hasSquash(activation)) {
    return activation.squash(weightedSum);
  }

  return weightedSum;
}

/**
 * Computes prediction errors for all non-input neurons.
 *
 * Input neurons are clamped and have zero prediction error.
 * Hidden neurons compute error as: ε = actual - predicted.
 * Output neurons compute error as: ε = actual - predicted (or target - predicted
 * when targets are provided).
 *
 * @param creature The creature containing the network topology.
 * @param activations Current activation values (indexed by neuron position).
 * @param targets Optional target values for output neurons (length = creature.output).
 * @returns Prediction errors, predictions, and total energy.
 */
export function computePredictionErrors(
  creature: Creature,
  activations: Float64Array,
  targets?: Float64Array,
): PredictionErrorResult {
  const neuronCount = creature.neurons.length;
  const errors = new Float64Array(neuronCount);
  const predictions = new Float64Array(neuronCount);

  let energy = 0;

  // Skip input neurons (indices 0..input-1): they are clamped, error = 0
  for (let i = creature.input; i < neuronCount; i++) {
    const prediction = computePrediction(creature, i, activations);
    predictions[i] = prediction;

    // For output neurons with targets, error is target - prediction
    const isOutput = i >= neuronCount - creature.output;
    if (isOutput && targets) {
      const outputIndex = i - (neuronCount - creature.output);
      const error = targets[outputIndex] - prediction;
      errors[i] = error;
    } else {
      // Hidden neurons: error = actual activation - prediction
      const error = activations[i] - prediction;
      errors[i] = error;
    }

    energy += errors[i] * errors[i];
  }

  // Energy = ½ Σ ε²
  energy *= 0.5;

  return { errors, predictions, energy };
}

/**
 * Type guard: checks whether an activation has a squash method.
 */
function hasSquash(
  activation: unknown,
): activation is ActivationInterface {
  return typeof (activation as ActivationInterface).squash === "function";
}
