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
  if (neuron.type == "constant") {
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
  if (neuron.type == "constant") {
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
    //288_417_500
    return currentBias;
  }

  const difference = config.learningRate * (targetBias - currentBias);
  const learntBias = currentBias + difference;
  let limitedBias = learntBias;
  if (Math.abs(difference) > config.maximumBiasAdjustmentScale) {
    if (difference > 0) {
      limitedBias = currentBias + config.maximumBiasAdjustmentScale;
    } else {
      limitedBias = currentBias - config.maximumBiasAdjustmentScale;
    }
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
