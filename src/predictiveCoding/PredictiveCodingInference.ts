/**
 * Predictive Coding inference engine (iterative settling).
 *
 * Issue #1554: Implements the "fast" inner loop where latent variables
 * iteratively settle to minimise prediction error energy. This is the
 * TypeScript reference implementation; a Rust/WASM version will follow.
 *
 * Algorithm:
 *   1. Clamp input neurons to observed data.
 *   2. Initialise hidden activations from a forward pass.
 *   3. Optionally clamp output neurons to target values.
 *   4. For t = 1..T_infer:
 *      a. Compute predictions and errors for all non-input neurons.
 *      b. Update hidden neuron latents: x(i) -= η · ∂ℒ/∂x(i).
 *      c. Check convergence: if energy < threshold, stop early.
 *   5. Return final latent states and prediction errors.
 */

import type { Creature } from "../Creature.ts";
import type { RequiredPredictiveCodingConfig } from "../config/PredictiveCodingConfig.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { AbstractActivationInterface } from "../methods/activations/AbstractActivationInterface.ts";
import {
  computePredictionErrors,
  type PredictionErrorResult,
} from "./PredictionErrorComputation.ts";

/**
 * Result of the PC inference (settling) process.
 */
export interface InferenceResult {
  /** Final activation values after settling. */
  readonly activations: Float64Array;

  /** Final prediction errors per neuron. */
  readonly errors: Float64Array;

  /** Final predictions per neuron. */
  readonly predictions: Float64Array;

  /** Final total energy (½ Σ ε²). */
  readonly energy: number;

  /** Number of inference steps actually performed. */
  readonly steps: number;

  /** Whether the inference converged (energy < threshold). */
  readonly converged: boolean;
}

/**
 * Runs the Predictive Coding inference (settling) loop.
 *
 * The inference loop iteratively adjusts hidden neuron activations
 * to minimise prediction error energy. Input neurons are clamped to
 * observed data. Output neurons may be clamped to targets for
 * supervised settling.
 *
 * @param creature The creature containing the network topology.
 * @param input Input data to clamp onto input neurons.
 * @param config PC configuration (inference steps, rate, threshold).
 * @param targets Optional target values for output neurons.
 * @returns The inference result containing settled activations, errors, and energy.
 */
export function runInference(
  creature: Creature,
  input: Float64Array,
  config: RequiredPredictiveCodingConfig,
  targets?: Float64Array,
): InferenceResult {
  const neuronCount = creature.neurons.length;
  const outputStart = neuronCount - creature.output;

  // Initialise activations: copy from a Float64Array-compatible source
  const activations = new Float64Array(neuronCount);

  // Clamp input neurons
  for (let i = 0; i < creature.input; i++) {
    activations[i] = input[i];
  }

  // Initialise hidden and output neurons from a simple forward pass
  initialiseForwardPass(creature, activations);

  // Clamp output neurons to targets if provided
  if (targets) {
    for (let i = 0; i < creature.output; i++) {
      activations[outputStart + i] = targets[i];
    }
  }

  // Pre-compute squash info for hidden neurons
  const hiddenDerivatives = precomputeDerivatives(creature);

  let lastResult: PredictionErrorResult = computePredictionErrors(
    creature,
    activations,
    targets,
  );
  let steps = 0;
  let converged = lastResult.energy < config.energyThreshold;

  // Iterative settling loop
  for (let t = 0; t < config.inferenceSteps && !converged; t++) {
    steps = t + 1;

    // Compute the gradient ∂ℒ/∂x(i) for each hidden neuron and update
    updateLatents(
      creature,
      activations,
      lastResult.errors,
      hiddenDerivatives,
      config.inferenceRate,
      outputStart,
      targets,
    );

    // Re-clamp input neurons (should be unchanged but safeguard)
    for (let i = 0; i < creature.input; i++) {
      activations[i] = input[i];
    }

    // Re-clamp output neurons if targets provided
    if (targets) {
      for (let i = 0; i < creature.output; i++) {
        activations[outputStart + i] = targets[i];
      }
    }

    // Recompute errors and energy
    lastResult = computePredictionErrors(creature, activations, targets);
    converged = lastResult.energy < config.energyThreshold;
  }

  // Store settled state in NeuronState (non-destructive: only PC fields)
  for (let i = creature.input; i < neuronCount; i++) {
    const nodeState = creature.state.node(i);
    nodeState.prediction = lastResult.predictions[i];
    nodeState.predictionError = lastResult.errors[i];
    nodeState.latentValue = activations[i];
  }

  return {
    activations,
    errors: lastResult.errors,
    predictions: lastResult.predictions,
    energy: lastResult.energy,
    steps,
    converged,
  };
}

/**
 * Performs a simple forward pass to initialise hidden/output activations.
 * Processes neurons in index order (topological order for feedforward networks).
 */
function initialiseForwardPass(
  creature: Creature,
  activations: Float64Array,
): void {
  for (let i = creature.input; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    const inward = creature.inwardConnections(i);

    let weightedSum = neuron.bias;
    for (let j = 0; j < inward.length; j++) {
      const synapse = inward[j];
      weightedSum += synapse.weight * activations[synapse.from];
    }

    const squashName = neuron.squash;
    if (squashName) {
      const act = Activations.find(squashName);
      if (hasSquash(act)) {
        activations[i] = act.squash(weightedSum);
      } else {
        activations[i] = weightedSum;
      }
    } else {
      activations[i] = weightedSum;
    }
  }
}

/**
 * Pre-computes derivative function availability for all neurons.
 * Returns an array indexed by neuron index with the derivative function
 * or null if not available.
 */
function precomputeDerivatives(
  creature: Creature,
): (((x: number) => number) | null)[] {
  const derivatives: (((x: number) => number) | null)[] = new Array(
    creature.neurons.length,
  );

  for (let i = 0; i < creature.neurons.length; i++) {
    const neuron = creature.neurons[i];
    if (i < creature.input || !neuron.squash) {
      derivatives[i] = null;
      continue;
    }

    const act = Activations.find(neuron.squash);
    if (act.derivative) {
      const derivFn = act.derivative.bind(act);
      derivatives[i] = derivFn;
    } else {
      derivatives[i] = null;
    }
  }

  return derivatives;
}

/**
 * Updates hidden neuron latent values using the PC gradient descent rule.
 *
 * The gradient of the energy w.r.t. a hidden neuron x(i) has two components:
 *   ∂ℒ/∂x(i) = ε(i) - Σ_k w_ik · f'(value_k) · ε(k)
 *
 * where:
 *   - ε(i) is the prediction error at neuron i (its own error)
 *   - The sum is over neurons k that neuron i sends predictions to
 *     (i.e., outward connections from i)
 *   - f'(value_k) is the derivative of k's squash at its pre-activation value
 *   - ε(k) is the prediction error at neuron k
 */
function updateLatents(
  creature: Creature,
  activations: Float64Array,
  errors: Float64Array,
  derivatives: (((x: number) => number) | null)[],
  inferenceRate: number,
  outputStart: number,
  targets?: Float64Array,
): void {
  // Only update hidden neurons (not input, not output when clamped)
  for (let i = creature.input; i < creature.neurons.length; i++) {
    // Skip output neurons if targets are provided (they are clamped)
    if (targets && i >= outputStart) continue;

    // Compute ∂ℒ/∂x(i) = ε(i) - Σ_k w_ik · f'(pre_k) · ε(k)
    let gradient = errors[i];

    // Subtract the downstream error contribution
    const outward = creature.outwardConnections(i);
    for (let j = 0; j < outward.length; j++) {
      const synapse = outward[j];
      const k = synapse.to;

      // Skip if the target neuron is an input (shouldn't happen normally)
      if (k < creature.input) continue;

      const errorK = errors[k];
      if (errorK === 0) continue;

      // Compute the pre-activation value for neuron k to get the derivative
      const derivFn = derivatives[k];
      if (derivFn) {
        // We need the pre-activation (value before squash) for neuron k
        // Approximate: use the inverse of the activation or recompute
        const preActivation = computePreActivation(creature, k, activations);
        const deriv = derivFn(preActivation);
        gradient -= synapse.weight * deriv * errorK;
      } else {
        // No derivative available: assume linear (derivative = 1)
        gradient -= synapse.weight * errorK;
      }
    }

    // Update: x(i) ← x(i) - η · ∂ℒ/∂x(i)
    activations[i] -= inferenceRate * gradient;
  }
}

/**
 * Computes the pre-activation (weighted sum before squash) for a neuron.
 */
function computePreActivation(
  creature: Creature,
  neuronIndex: number,
  activations: Float64Array,
): number {
  const neuron = creature.neurons[neuronIndex];
  const inward = creature.inwardConnections(neuronIndex);

  let weightedSum = neuron.bias;
  for (let i = 0; i < inward.length; i++) {
    const synapse = inward[i];
    weightedSum += synapse.weight * activations[synapse.from];
  }

  return weightedSum;
}

/**
 * Type guard: checks whether an activation has a squash method.
 */
function hasSquash(
  activation: AbstractActivationInterface,
): activation is ActivationInterface {
  return typeof (activation as ActivationInterface).squash === "function";
}
