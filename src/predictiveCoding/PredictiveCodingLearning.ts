/**
 * Predictive Coding local Hebbian learning rules.
 *
 * Issue #1555: Implements the "slow" learning phase — weight updates
 * based on locally available pre-synaptic activity and post-synaptic error.
 * This is the key differentiator from standard backpropagation: each
 * synapse update depends only on the error at its target neuron, the
 * activation of its source neuron, and the local derivative of the
 * activation function.
 *
 * Weight update rule (after inference has settled):
 *   ΔW(j→i) = η_learn · f'(a(i)) · ε(i) · x(j)
 *
 * Bias update rule:
 *   Δb(i) = η_learn · f'(a(i)) · ε(i)
 *
 * Where:
 *   η_learn = PC learning rate (from config)
 *   f'(a(i)) = derivative of squash function at pre-activation of target neuron
 *   ε(i) = prediction error at target neuron (from inference)
 *   x(j) = activation of source neuron (latent value after settling)
 */

import type { Creature } from "@creature";
import type { RequiredPredictiveCodingConfig } from "@config/PredictiveCodingConfig.ts";
import type { InferenceResult } from "@predictiveCoding/PredictiveCodingInference.ts";
import { Activations } from "@methods/activations/Activations.ts";
import type { ActivationInterface } from "@methods/activations/ActivationInterface.ts";
import { clampAndTrack } from "@utils/OverflowGuardStats.ts";

/** Minimum weight magnitude (plank constant). */
const PLANK = 1e-7;

/**
 * Gradient for a single synapse weight update.
 */
export interface SynapseGradient {
  /** Index into creature.synapses. */
  synapseIndex: number;
  /** The computed weight delta to apply. */
  delta: number;
}

/**
 * Gradient for a single neuron bias update.
 */
export interface BiasGradient {
  /** Index into creature.neurons. */
  neuronIndex: number;
  /** The computed bias delta to apply. */
  delta: number;
}

/**
 * Collection of all weight and bias gradients for a single sample.
 */
export interface WeightGradients {
  synapseGradients: SynapseGradient[];
  biasGradients: BiasGradient[];
}

/**
 * Computes the pre-activation (weighted input sum) for a neuron.
 */
function computePreActivation(
  creature: Creature,
  neuronIndex: number,
  latents: Float64Array,
): number {
  const neuron = creature.neurons[neuronIndex];
  const inward = creature.inwardConnections(neuronIndex);

  let weightedSum = neuron.bias;
  for (const synapse of inward) {
    weightedSum += synapse.weight * latents[synapse.from];
  }
  return weightedSum;
}

/**
 * Computes local Hebbian weight and bias gradients from settled inference state.
 *
 * For each synapse j→i:
 *   ΔW = η_learn · f'(a(i)) · ε(i) · x(j)
 *
 * For each non-input neuron i:
 *   Δb(i) = η_learn · f'(a(i)) · ε(i)
 *
 * @param creature The creature whose weights will be updated.
 * @param inferenceResult The settled inference state (latents and errors).
 * @param config Predictive Coding configuration.
 * @returns Weight and bias gradients for all synapses and non-input neurons.
 */
export function computeWeightGradients(
  creature: Creature,
  inferenceResult: InferenceResult,
  config: RequiredPredictiveCodingConfig,
): WeightGradients {
  const { latents, predictionErrors } = inferenceResult;

  const synapseGradients: SynapseGradient[] = [];
  const biasGradients: BiasGradient[] = [];

  // Pre-resolve squash functions and derivatives for each neuron.
  // Guard: aggregate activations (IF, MAXIMUM, etc.) implement
  // NeuronActivationInterface, not ActivationInterface, so they lack
  // scalar squash()/derivative() methods. Treat those as null (identity).
  const squashFunctions = new Map<number, ActivationInterface | null>();
  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    if (neuron.squash) {
      const found = Activations.find(neuron.squash);
      squashFunctions.set(
        i,
        "squash" in found ? (found as ActivationInterface) : null,
      );
    } else {
      squashFunctions.set(i, null);
    }
  }

  // Compute bias gradients for all non-input neurons.
  for (const [neuronIndex, nodeState] of predictionErrors) {
    const squash = squashFunctions.get(neuronIndex);
    let derivative = 1.0;

    if (squash?.derivative) {
      const preActivation = computePreActivation(
        creature,
        neuronIndex,
        latents,
      );
      derivative = squash.derivative(preActivation);
    }

    biasGradients.push({
      neuronIndex,
      delta: config.learningRate * derivative * nodeState.error,
    });
  }

  // Compute synapse weight gradients.
  for (let s = 0; s < creature.synapses.length; s++) {
    const synapse = creature.synapses[s];
    const targetError = predictionErrors.get(synapse.to);

    if (!targetError) {
      // Target neuron has no prediction error (e.g., input neuron).
      synapseGradients.push({ synapseIndex: s, delta: 0 });
      continue;
    }

    // Compute the derivative at the target neuron's pre-activation.
    const squash = squashFunctions.get(synapse.to);
    let derivative = 1.0;

    if (squash?.derivative) {
      const preActivation = computePreActivation(
        creature,
        synapse.to,
        latents,
      );
      derivative = squash.derivative(preActivation);
    }

    const sourceLatent = latents[synapse.from];
    const delta = config.learningRate * derivative * targetError.error *
      sourceLatent;

    synapseGradients.push({ synapseIndex: s, delta });
  }

  return { synapseGradients, biasGradients };
}

/**
 * Applies computed Hebbian weight and bias updates to a creature.
 *
 * Respects:
 * - Plank precision (weights below 1e-7 magnitude snap to zero)
 * - Synapse type constraints (positive stays >= 0, negative stays <= 0)
 * - Condition synapses are not updated
 *
 * @param creature The creature to update.
 * @param gradients The gradients to apply.
 */
export function applyHebbianUpdate(
  creature: Creature,
  gradients: WeightGradients,
): void {
  // Apply synapse weight updates.
  for (const sg of gradients.synapseGradients) {
    const synapse = creature.synapses[sg.synapseIndex];

    // Condition synapses are structural — do not update.
    if (synapse.type === "condition") continue;

    let newWeight = synapse.weight + sg.delta;

    // Enforce synapse type constraints.
    if (synapse.type === "positive" && newWeight < 0) {
      newWeight = 0;
    } else if (synapse.type === "negative" && newWeight > 0) {
      newWeight = 0;
    }

    // Enforce plank precision.
    if (newWeight !== 0 && Math.abs(newWeight) < PLANK) {
      newWeight = 0;
    }

    // Issue #2421: Clamp proactively — with extreme prediction errors and a
    // compounding learning rate the Hebbian update can drift far outside the
    // safe range; reactive load-time clamping has been observed to fire on
    // values as large as 1e+195.
    synapse.weight = clampAndTrack(
      newWeight,
      "predictiveCoding.weight",
      "applyHebbianUpdate",
    );
  }

  // Apply bias updates.
  for (const bg of gradients.biasGradients) {
    const neuron = creature.neurons[bg.neuronIndex];
    // Issue #2421: Clamp proactively to keep bias in the safe range.
    neuron.bias = clampAndTrack(
      neuron.bias + bg.delta,
      "predictiveCoding.bias",
      "applyHebbianUpdate",
    );
  }
}
