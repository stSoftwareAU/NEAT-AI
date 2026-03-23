/**
 * Prediction-Error-Guided Mutation for NEAT structural evolution.
 *
 * Issue #1557: Uses Predictive Coding prediction errors to guide NEAT's
 * structural mutations — adding neurons and connections where prediction
 * errors are highest. Neurons with high prediction error indicate areas
 * where the network's internal model is poorest, providing a principled
 * signal for where the topology should grow.
 *
 * When PC is disabled (no prediction errors available), mutation operates
 * exactly as before with uniform random selection.
 */

import type { Creature } from "../Creature.ts";
import { TopologyError } from "../errors/TopologyError.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

/**
 * Mutation bias computed from Predictive Coding prediction errors.
 *
 * Provides per-neuron and per-synapse probability weights for guiding
 * structural mutations towards high-error regions of the network.
 */
export interface MutationBias {
  /** Neuron UUID → normalised mutation probability weight. */
  neuronWeights: Map<number, number>;

  /**
   * Synapse key → normalised mutation probability weight.
   * Key format: "fromIndex:toIndex".
   */
  synapseWeights: Map<string, number>;
}

/**
 * Computes a MutationBias from the creature's current prediction errors.
 *
 * Reads the `predictionError` field from each neuron's state (populated
 * by Predictive Coding inference). The absolute error magnitude is used
 * as a raw weight, then normalised so weights sum to 1.0.
 *
 * For synapses, the weight is the maximum absolute prediction error of
 * the two connected neurons — a synapse connecting high-error neurons
 * is a strong candidate for structural mutation.
 *
 * @param creature The creature whose prediction errors guide mutation.
 * @returns A MutationBias, or undefined if no prediction errors are available.
 */
export function computeMutationBias(
  creature: Creature,
): MutationBias | undefined {
  // Collect absolute prediction errors for non-input neurons.
  const rawErrors = new Map<number, number>();
  let hasAnyError = false;

  for (let i = creature.input; i < creature.neurons.length; i++) {
    const state = creature.state.node(i);
    if (state.predictionError !== undefined) {
      rawErrors.set(i, Math.abs(state.predictionError));
      hasAnyError = true;
    }
  }

  // No prediction errors available — PC has not been run.
  if (!hasAnyError) {
    return undefined;
  }

  // Compute neuron weights from absolute errors.
  const neuronWeights = new Map<number, number>();
  let totalNeuronWeight = 0;

  for (const [_index, absError] of rawErrors) {
    totalNeuronWeight += absError;
  }

  // If all errors are zero, use uniform weights.
  const uniformNeuronWeight = rawErrors.size > 0 ? 1.0 / rawErrors.size : 0;

  for (const [index, absError] of rawErrors) {
    const neuron = creature.neurons[index];
    const weight = totalNeuronWeight > 0
      ? absError / totalNeuronWeight
      : uniformNeuronWeight;
    neuronWeights.set(neuron.id, weight);
  }

  // Compute synapse weights from connected neuron errors.
  // Use the maximum absolute error of the two connected neurons.
  const synapseWeights = new Map<string, number>();
  let totalSynapseWeight = 0;

  for (const synapse of creature.synapses) {
    const fromError = rawErrors.get(synapse.from) ?? 0;
    const toError = rawErrors.get(synapse.to) ?? 0;
    const maxError = Math.max(fromError, toError);
    const key = `${synapse.from}:${synapse.to}`;
    synapseWeights.set(key, maxError);
    totalSynapseWeight += maxError;
  }

  // Normalise synapse weights.
  const uniformSynapseWeight = synapseWeights.size > 0
    ? 1.0 / synapseWeights.size
    : 0;

  for (const [key, rawWeight] of synapseWeights) {
    const weight = totalSynapseWeight > 0
      ? rawWeight / totalSynapseWeight
      : uniformSynapseWeight;
    synapseWeights.set(key, weight);
  }

  return { neuronWeights, synapseWeights };
}

/**
 * Selects a candidate index using weighted random selection.
 *
 * Given a list of candidate indices and a weight map (index → weight),
 * picks a candidate with probability proportional to its weight.
 * Falls back to uniform random selection if no candidates have matching
 * weights in the map.
 *
 * @param candidates Array of candidate indices to select from.
 * @param weights Map of index → probability weight.
 * @returns The selected candidate index.
 */
export function selectWeightedIndex(
  candidates: number[],
  weights: Map<number, number>,
): number {
  if (candidates.length === 0) {
    throw new TopologyError(
      "selectWeightedIndex: no candidates provided",
      "INVALID_STATE",
    );
  }

  const rng = getRandomNumberGenerator();

  // Collect weights for the candidates that have entries in the map.
  let totalWeight = 0;
  for (const c of candidates) {
    totalWeight += weights.get(c) ?? 0;
  }

  // If no candidates have matching weights, fall back to uniform selection.
  if (totalWeight <= 0) {
    return candidates[Math.floor(rng.random() * candidates.length)];
  }

  // Weighted random selection using cumulative distribution.
  const threshold = rng.random() * totalWeight;
  let cumulative = 0;
  for (const c of candidates) {
    cumulative += weights.get(c) ?? 0;
    if (cumulative >= threshold) {
      return c;
    }
  }

  // Floating-point edge case: return last candidate.
  return candidates[candidates.length - 1];
}

/**
 * Creates an index-based weight map from a MutationBias and creature.
 *
 * Converts the UUID-keyed neuronWeights to index-keyed weights for use
 * with selectWeightedIndex in mutation operators.
 *
 * @param bias The MutationBias computed from prediction errors.
 * @param creature The creature whose neurons map UUIDs to indices.
 * @returns Map of neuron index → normalised weight.
 */
export function neuronBiasToIndexWeights(
  bias: MutationBias,
  creature: Creature,
): Map<number, number> {
  const indexWeights = new Map<number, number>();
  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    const weight = bias.neuronWeights.get(neuron.id);
    if (weight !== undefined) {
      indexWeights.set(i, weight);
    }
  }
  return indexWeights;
}
