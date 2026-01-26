import type { NeuronState } from "../architecture/CreatureState.ts";
import type { Neuron } from "../architecture/Neuron.ts";
import type { BackPropagationConfig } from "./BackPropagation.ts";

export function accumulateBias(
  ns: NeuronState,
  targetPreActivationValue: number,
  preActivationValue: number,
  currentBias: number,
  config: BackPropagationConfig,
) {
  const biasDelta = targetPreActivationValue - preActivationValue;

  ns.count++;
  const targetBias = currentBias + biasDelta;
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
      const totalBias = ns.totalAdjustedBias +
        (neuron.bias * config.generations);
      const samples = ns.count + config.generations;

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
    const ns = nsArray[i];
    const biasDelta = targetPreActivationValues[i] - preActivationValues[i];
    const currentBias = currentBiases[i];

    ns.count++;
    const targetBias = currentBias + biasDelta;
    ns.totalBias += targetBias;
    ns.totalAdjustedBias += limitBias(targetBias, currentBias, config);
  }
}

/**
 * Issue #1214 - Batch bias accumulation for 8 neurons simultaneously.
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
    const ns = nsArray[i];
    const biasDelta = targetPreActivationValues[i] - preActivationValues[i];
    const currentBias = currentBiases[i];

    ns.count++;
    const targetBias = currentBias + biasDelta;
    ns.totalBias += targetBias;
    ns.totalAdjustedBias += limitBias(targetBias, currentBias, config);
  }
}
