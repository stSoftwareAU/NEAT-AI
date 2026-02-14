import type { NeuronState } from "../architecture/CreatureState.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import type { BackPropagationConfig } from "./BackPropagation.ts";

/**
 * Accumulates bias adjustments for a neuron during backpropagation.
 *
 * Issue #1314 - Non-finite pre-activation values are detected early and
 * the accumulation is skipped to prevent corruption of the neuron state.
 * This protects against Infinity, -Infinity, and NaN values.
 */
export function accumulateBias(
  ns: NeuronState,
  targetPreActivationValue: number,
  preActivationValue: number,
  currentBias: number,
  config: BackPropagationConfig,
) {
  // Issue #1314: Guard against non-finite inputs that would produce non-finite bias
  if (
    !Number.isFinite(targetPreActivationValue) ||
    !Number.isFinite(preActivationValue) ||
    !Number.isFinite(currentBias)
  ) {
    // Skip this accumulation to prevent state corruption
    return;
  }

  const biasDelta = targetPreActivationValue - preActivationValue;

  // Issue #1314: Guard against non-finite biasDelta (e.g., from extreme values)
  if (!Number.isFinite(biasDelta)) {
    return;
  }

  const targetBias = currentBias + biasDelta;

  // Issue #1314: Guard against non-finite targetBias
  if (!Number.isFinite(targetBias)) {
    return;
  }

  ns.count++;
  ns.totalBias += targetBias;
  ns.totalAdjustedBias += limitBias(targetBias, currentBias, config);
}

export function adjustedBias(
  neuron: Neuron,
  config: BackPropagationConfig,
): number {
  if (neuron.type === "constant") {
    return neuron.bias;
  } else {
    if (config.disableBiasAdjustment) {
      return neuron.bias;
    }

    const ns = neuron.creature.state.node(neuron.index);

    if (ns.count && ns.count % config.batchSize === 0) {
      ns.batchBias = calculateBias(neuron, config);
    }

    if (ns.batchBias !== undefined) {
      return ns.batchBias;
    }

    return neuron.bias;
  }
}

export function calculateBias(
  neuron: Neuron,
  config: BackPropagationConfig,
): number {
  if (neuron.type === "constant") {
    return neuron.bias;
  } else {
    if (config.disableBiasAdjustment) {
      return neuron.bias;
    }
    const ns = neuron.creature.state.node(neuron.index);

    if (!ns.noChange && ns.count) {
      // Issue #1436: Cap effective generations to avoid overwhelming the
      // gradient signal. Without this cap, high config.generations values
      // create excessive bias inertia that slows convergence.
      const effectiveGenerations = Math.min(
        config.generations,
        ns.count * 2,
      );
      const totalBias = ns.totalAdjustedBias +
        (neuron.bias * effectiveGenerations);
      const samples = ns.count + effectiveGenerations;

      const adjustedBias = totalBias / samples;

      return limitBias(adjustedBias, neuron.bias, config);
    }

    return neuron.bias;
  }
}

export function limitBias(
  targetBias: number,
  currentBias: number,
  config: BackPropagationConfig,
) {
  if (!Number.isFinite(targetBias)) {
    throw new Error(`Bias must be a finite number, got ${targetBias}`);
  }

  if (Math.abs(targetBias) < config.plankConstant) {
    return 0;
  }

  if (Math.abs(targetBias - currentBias) < 0.000_000_001) {
    return currentBias;
  }

  const difference = config.learningRate * (targetBias - currentBias);
  const learntBias = currentBias + difference;
  let limitedBias = learntBias;
  if (Math.abs(difference) > config.maximumBiasAdjustmentScale) {
    limitedBias = currentBias +
      config.maximumBiasAdjustmentScale * Math.sign(difference);
  }

  if (Math.abs(limitedBias) >= config.limitBiasScale) {
    if (limitedBias > 0) {
      if (limitedBias > currentBias) {
        limitedBias = Math.max(currentBias, config.limitBiasScale);
      }
    } else {
      if (limitedBias < currentBias) {
        limitedBias = Math.min(currentBias, config.limitBiasScale * -1);
      }
    }
  }

  return limitedBias;
}

/**
 * Issue #1214 - Batch bias accumulation for 4 neurons simultaneously.
 * Issue #1314 - Non-finite values are skipped to prevent state corruption.
 *
 * Processes 4 neurons in a single call, enabling potential SIMD optimisation
 * by V8 when processing mini-batches during backpropagation.
 *
 * @param nsArray Array of 4 NeuronState objects to accumulate into
 * @param targetPreActivationValues Array of 4 target pre-activation values
 * @param preActivationValues Array of 4 current pre-activation values
 * @param currentBiases Array of 4 current neuron biases
 * @param config Backpropagation configuration
 */
export function accumulateBiasBatch4Way(
  nsArray: NeuronState[],
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  config: BackPropagationConfig,
) {
  // Process all 4 neurons - enables V8 SIMD optimisation with typed arrays
  for (let i = 0; i < 4; i++) {
    const targetPreActivation = targetPreActivationValues[i];
    const preActivation = preActivationValues[i];
    const currentBias = currentBiases[i];

    // Issue #1314: Skip non-finite values
    if (
      !Number.isFinite(targetPreActivation) ||
      !Number.isFinite(preActivation) ||
      !Number.isFinite(currentBias)
    ) {
      continue;
    }

    const biasDelta = targetPreActivation - preActivation;
    if (!Number.isFinite(biasDelta)) {
      continue;
    }

    const targetBias = currentBias + biasDelta;
    if (!Number.isFinite(targetBias)) {
      continue;
    }

    const ns = nsArray[i];
    ns.count++;
    ns.totalBias += targetBias;
    ns.totalAdjustedBias += limitBias(targetBias, currentBias, config);
  }
}

/**
 * Issue #1214 - Batch bias accumulation for 8 neurons simultaneously.
 * Issue #1314 - Non-finite values are skipped to prevent state corruption.
 *
 * Processes 8 neurons in a single call, enabling potential SIMD optimisation
 * by V8 when processing mini-batches during backpropagation.
 * Uses two parallel 4-way operations for better cache utilisation.
 *
 * @param nsArray Array of 8 NeuronState objects to accumulate into
 * @param targetPreActivationValues Array of 8 target pre-activation values
 * @param preActivationValues Array of 8 current pre-activation values
 * @param currentBiases Array of 8 current neuron biases
 * @param config Backpropagation configuration
 */
export function accumulateBiasBatch8Way(
  nsArray: NeuronState[],
  targetPreActivationValues: number[],
  preActivationValues: number[],
  currentBiases: number[],
  config: BackPropagationConfig,
) {
  // Process all 8 neurons - enables V8 SIMD optimisation with typed arrays
  for (let i = 0; i < 8; i++) {
    const targetPreActivation = targetPreActivationValues[i];
    const preActivation = preActivationValues[i];
    const currentBias = currentBiases[i];

    // Issue #1314: Skip non-finite values
    if (
      !Number.isFinite(targetPreActivation) ||
      !Number.isFinite(preActivation) ||
      !Number.isFinite(currentBias)
    ) {
      continue;
    }

    const biasDelta = targetPreActivation - preActivation;
    if (!Number.isFinite(biasDelta)) {
      continue;
    }

    const targetBias = currentBias + biasDelta;
    if (!Number.isFinite(targetBias)) {
      continue;
    }

    const ns = nsArray[i];
    ns.count++;
    ns.totalBias += targetBias;
    ns.totalAdjustedBias += limitBias(targetBias, currentBias, config);
  }
}
