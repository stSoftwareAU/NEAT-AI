/**
 * Predictive Coding inference (settling) engine.
 *
 * Issue #1554: Implements the iterative inference loop where latent
 * variables settle to minimise prediction error energy. This is the
 * "fast" inner loop of the Predictive Coding framework.
 *
 * Algorithm per data sample:
 *   1. Clamp input neurons to observed data.
 *   2. Initialise latent variables (hidden neurons) from forward prediction.
 *   3. For t = 1..T_infer:
 *      a. Compute predictions and errors for all non-input neurons.
 *      b. Compute total energy E = ½ Σ ε(l)².
 *      c. Update hidden neuron latents: x(l) -= η * ∂E/∂x(l).
 *      d. If E < energyThreshold, stop early.
 *   4. Return final latent states and prediction errors.
 *
 * Works with arbitrary NEAT topologies using the creature's
 * inward/outward connection accessors rather than strict layers.
 */

import type { Creature } from "../Creature.ts";
import type { RequiredPredictiveCodingConfig } from "../config/PredictiveCodingConfig.ts";
import type { PredictionNodeState } from "../architecture/PredictionNodeState.ts";
import {
  computePrediction,
  computePredictionErrors,
  computeTotalEnergy,
} from "./PredictionErrorComputation.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { computeEffectiveConfig } from "./AdaptiveScaling.ts";

/**
 * Result returned by the inference settling loop.
 */
export interface InferenceResult {
  /** Final latent values for all neurons. */
  latents: Float64Array;
  /** Per-neuron prediction errors (keyed by neuron index). */
  predictionErrors: Map<number, PredictionNodeState>;
  /** Total prediction error energy at convergence. */
  finalEnergy: number;
  /** Energy at each iteration (for diagnostics). */
  energyHistory: number[];
  /** Number of inference steps actually used. */
  stepsUsed: number;
  /** Whether energy converged below the threshold. */
  converged: boolean;
}

/**
 * Runs Predictive Coding inference (settling) on a creature.
 *
 * Input neurons are clamped to the observed data and remain fixed.
 * Hidden neuron latent values are iteratively updated to minimise
 * prediction error energy. Output neurons may optionally be clamped
 * to supervised targets.
 *
 * This function is non-destructive to the creature's topology —
 * only NeuronState PC fields are updated with the final results.
 *
 * @param creature The creature to run inference on.
 * @param input Observed input data (one value per input neuron).
 * @param config Predictive Coding configuration.
 * @param targets Optional supervised targets for output neurons.
 * @returns The inference result with final latents and errors.
 */
export function runInference(
  creature: Creature,
  input: Float32Array,
  config: RequiredPredictiveCodingConfig,
  targets?: Float64Array,
): InferenceResult {
  const neuronCount = creature.neurons.length;
  const inputCount = creature.input;

  // Step 1: Initialise latent values array.
  const latents = new Float64Array(neuronCount);

  // Clamp input neurons to observed data.
  for (let i = 0; i < inputCount; i++) {
    latents[i] = input[i];
  }

  // Initialise hidden neurons from their forward predictions.
  // Process neurons in index order (which respects topological order
  // in NEAT-AI since neurons are sorted by index).
  for (let i = inputCount; i < neuronCount; i++) {
    latents[i] = computePrediction(creature, i, latents);
  }

  // Clamp output neurons to targets if provided.
  if (targets) {
    const outputStart = neuronCount - creature.output;
    for (let j = 0; j < creature.output; j++) {
      if (j < targets.length) {
        latents[outputStart + j] = targets[j];
      }
    }
  }

  // Identify which neurons are hidden (updatable during inference).
  const hiddenIndices: number[] = [];
  for (let i = 0; i < neuronCount; i++) {
    if (creature.neurons[i].type === "hidden") {
      hiddenIndices.push(i);
    }
  }

  // Pre-resolve squash functions for each neuron with a derivative.
  // Guard: aggregate activations (IF, MAXIMUM, etc.) implement
  // NeuronActivationInterface, not ActivationInterface, so they lack
  // scalar squash()/derivative() methods. Treat those as null (identity).
  const squashFunctions = new Array<ActivationInterface | null>(neuronCount);
  for (let i = 0; i < neuronCount; i++) {
    const neuron = creature.neurons[i];
    if (neuron.squash) {
      const found = Activations.find(neuron.squash);
      squashFunctions[i] = "squash" in found
        ? (found as ActivationInterface)
        : null;
    } else {
      squashFunctions[i] = null;
    }
  }

  // Issue #1915: Apply adaptive scaling for complex creatures.
  const effective = computeEffectiveConfig(creature, config);

  // Step 2: Iterative settling loop.
  const energyHistory: number[] = [];
  let converged = false;
  let stepsUsed = 0;
  let nodeStates: Map<number, PredictionNodeState>;

  // Compute initial errors.
  nodeStates = computePredictionErrors(creature, latents);
  let energy = computeTotalEnergy(nodeStates);
  energyHistory.push(energy);

  for (let t = 0; t < config.inferenceSteps; t++) {
    stepsUsed = t + 1;

    // Check convergence using the adaptive energy threshold.
    if (energy <= effective.energyThreshold) {
      converged = true;
      break;
    }

    // Compute gradient ∂E/∂x(l) for each hidden neuron and update.
    // For each hidden neuron l:
    //   ∂E/∂x(l) = ε(l) + Σ_m [ -w(l→m) * ε(m) * squash'(v_m) ]
    //
    // where:
    //   ε(l) = x(l) - x̂(l)  (the error at this neuron)
    //   The sum is over all neurons m that this neuron feeds into
    //   w(l→m) is the weight of the connection from l to m
    //   squash'(v_m) is the derivative of m's squash at the current value
    //   v_m is the weighted input sum to neuron m
    //
    // Issue #1915: Collect all gradients first, then normalise before applying,
    // to prevent vanishing/exploding updates in deep topologies.
    const gradients = new Float64Array(hiddenIndices.length);

    for (let h = 0; h < hiddenIndices.length; h++) {
      const hiddenIdx = hiddenIndices[h];
      const hiddenError = nodeStates.get(hiddenIdx);
      if (!hiddenError) continue;

      // Term 1: error at this neuron.
      let gradient = hiddenError.error;

      // Term 2: contribution from downstream neurons.
      const outward = creature.outwardConnections(hiddenIdx);
      for (const synapse of outward) {
        const targetState = nodeStates.get(synapse.to);
        if (!targetState) continue;

        // Compute the derivative of the target neuron's squash function.
        let derivative = 1.0;
        const targetSquash = squashFunctions[synapse.to];
        if (targetSquash?.derivative) {
          // Compute the weighted input sum to the target neuron.
          const targetNeuron = creature.neurons[synapse.to];
          const targetInward = creature.inwardConnections(synapse.to);
          let weightedSum = targetNeuron.bias;
          for (const inSynapse of targetInward) {
            weightedSum += inSynapse.weight * latents[inSynapse.from];
          }
          derivative = targetSquash.derivative(weightedSum);
        }

        gradient -= synapse.weight * targetState.error * derivative;
      }

      gradients[h] = gradient;
    }

    // Issue #1915: Normalise gradient vector to prevent
    // divergence in deep topologies with large gradient sums.
    let gradientNormSq = 0;
    for (let h = 0; h < gradients.length; h++) {
      gradientNormSq += gradients[h] * gradients[h];
    }
    const gradientNorm = Math.sqrt(gradientNormSq);
    const MAX_GRADIENT_NORM = 1.0;
    const scale = gradientNorm > MAX_GRADIENT_NORM
      ? MAX_GRADIENT_NORM / gradientNorm
      : 1.0;

    // Apply scaled gradients using the adaptive inference rate.
    for (let h = 0; h < hiddenIndices.length; h++) {
      latents[hiddenIndices[h]] -= effective.inferenceRate * scale *
        gradients[h];
    }

    // Re-clamp input neurons (should already be clamped, but be safe).
    for (let i = 0; i < inputCount; i++) {
      latents[i] = input[i];
    }

    // Re-clamp output neurons to targets if provided.
    if (targets) {
      const outputStart = neuronCount - creature.output;
      for (let j = 0; j < creature.output; j++) {
        if (j < targets.length) {
          latents[outputStart + j] = targets[j];
        }
      }
    }

    // Recompute errors and energy.
    nodeStates = computePredictionErrors(creature, latents);
    energy = computeTotalEnergy(nodeStates);
    energyHistory.push(energy);
  }

  // Check final convergence if loop finished without early stopping.
  if (!converged && energy <= config.energyThreshold) {
    converged = true;
  }

  // Store inference state in NeuronState PC fields.
  for (const [idx, state] of nodeStates) {
    const neuronState = creature.state.node(idx);
    neuronState.prediction = state.prediction;
    neuronState.predictionError = state.error;
    neuronState.latentValue = state.latent;
  }

  return {
    latents,
    predictionErrors: nodeStates,
    finalEnergy: energy,
    energyHistory,
    stepsUsed,
    converged,
  };
}
