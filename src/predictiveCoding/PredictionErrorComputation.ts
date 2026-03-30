/**
 * Prediction error computation for Predictive Coding inference.
 *
 * Issue #1554: Computes per-neuron prediction errors and total energy
 * for the PC inference loop. Each non-input neuron receives a top-down
 * prediction from its inward connections, and the error is the difference
 * between the neuron's current latent value and that prediction.
 *
 * - Per-neuron prediction: x̂(l) = squash(Σ w_i · x(source_i) + bias)
 * - Per-neuron error:      ε(l) = x(l) - x̂(l)
 * - Total energy:          E = ½ Σ ε(l)²
 */

import type { Creature } from "@creature";
import type { PredictionNodeState } from "@architecture/PredictionNodeState.ts";
import { Activations } from "@methods/activations/Activations.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";

/**
 * Computes the top-down prediction for a single neuron.
 *
 * For non-input neurons this is:
 *   squash(Σ weight_i * latent[source_i] + bias)
 *
 * For input neurons (which have no inward connections) the prediction
 * is simply the latent value itself (clamped observation).
 *
 * @param creature The creature whose topology defines the connections.
 * @param neuronIndex Index of the neuron to compute prediction for.
 * @param latents Current latent values for all neurons.
 * @returns The predicted activation for the neuron.
 */
export function computePrediction(
  creature: Creature,
  neuronIndex: number,
  latents: Float64Array,
): number {
  const neuron = creature.neurons[neuronIndex];

  // Input neurons are clamped — their prediction equals their latent value.
  if (neuron.type === "input") {
    return latents[neuronIndex];
  }

  const inward = creature.inwardConnections(neuronIndex);

  // Compute weighted sum of incoming latent values plus bias.
  let weightedSum = neuron.bias;
  for (let i = 0; i < inward.length; i++) {
    const synapse = inward[i];
    weightedSum += synapse.weight * latents[synapse.from];
  }

  // Apply the neuron's squash (activation) function.
  // Guard: aggregate activations (IF, MAXIMUM, etc.) implement
  // NeuronActivationInterface, not ActivationInterface, so they lack
  // a scalar squash() method. Fall through to identity for those.
  if (neuron.squash) {
    const activation = Activations.find(neuron.squash);
    if ("squash" in activation) {
      return (activation as ActivationInterface).squash(weightedSum);
    }
  }

  return weightedSum;
}

/**
 * Computes prediction errors for all non-input neurons.
 *
 * @param creature The creature whose topology defines the connections.
 * @param latents Current latent values for all neurons.
 * @returns Map from neuron index to PredictionNodeState.
 */
export function computePredictionErrors(
  creature: Creature,
  latents: Float64Array,
): Map<number, PredictionNodeState> {
  const nodeStates = new Map<number, PredictionNodeState>();

  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];

    // Skip input neurons — they are clamped observations.
    if (neuron.type === "input") continue;

    const prediction = computePrediction(creature, i, latents);
    const latent = latents[i];
    const error = latent - prediction;

    nodeStates.set(i, { prediction, error, latent });
  }

  return nodeStates;
}

/**
 * Computes total prediction error energy: E = ½ Σ ε(l)².
 *
 * @param nodeStates Per-neuron prediction states.
 * @returns The total energy (non-negative).
 */
export function computeTotalEnergy(
  nodeStates: Map<number, PredictionNodeState>,
): number {
  let energy = 0;
  for (const state of nodeStates.values()) {
    energy += state.error * state.error;
  }
  return 0.5 * energy;
}
