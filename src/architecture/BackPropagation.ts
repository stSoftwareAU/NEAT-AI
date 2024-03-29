import { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import { SynapseState } from "../propagate/SynapseState.ts";
import { CreatureState } from "./CreatureState.ts";
import { Neuron } from "./Neuron.ts";
import { Synapse } from "./Synapse.ts";

export interface BackPropagationOptions {
  disableRandomSamples?: boolean;
  useAverageDifferenceBias?: "Yes" | "No" | "Maybe";

  /**
   * The amount of previous generations if not set it'll be a random number between 1-100.
   * The higher number of generations the lower the learning rate
   */
  generations?: number;

  /**
   * The learning rate. Between 0..1, Default random number.
   */
  learningRate?: number;

  /**
   * The maximum +/- the bias will be adjusted in one training iteration. Default 10, Minimum 0.1
   */
  maximumBiasAdjustmentScale?: number;

  /**
   * The maximum +/- the weight will be adjusted in one training iteration. Default 10, Minimum 0.1
   */
  maximumWeightAdjustmentScale?: number;

  /**
   * The limit +/- of the bias, training will not adjust beyond this scale. Default 10_000, Minimum 1
   */
  limitBiasScale?: number;

  /**
   * The limit +/- of the weight, training will not adjust beyond this scale. Default 100_000, Minimum 1
   */
  limitWeightScale?: number;

  /** When limiting the weight/bias use exponential scaling, Default enabled */
  disableExponentialScaling?: boolean;

  /** the minimum unit of weights/biases */
  plankConstant?: number;
}

export class BackPropagationConfig implements BackPropagationOptions {
  disableRandomSamples: boolean;

  useAverageDifferenceBias: "Yes" | "No" | "Maybe";
  generations: number;

  learningRate: number;

  maximumBiasAdjustmentScale: number;

  maximumWeightAdjustmentScale: number;

  limitBiasScale: number;

  limitWeightScale: number;
  disableExponentialScaling?: boolean;

  plankConstant: number;

  constructor(options?: BackPropagationOptions) {
    this.disableRandomSamples = options?.disableRandomSamples ?? false;
    if (
      options?.useAverageDifferenceBias
    ) {
      this.useAverageDifferenceBias = options?.useAverageDifferenceBias;
    } else {
      this.useAverageDifferenceBias = "Yes";
    }

    this.generations = Math.max(
      options?.generations ?? Math.floor(Math.random() * 100) + 1,
      0,
    );

    this.maximumBiasAdjustmentScale = Math.max(
      options?.maximumBiasAdjustmentScale ?? 10,
      0,
    );

    this.maximumWeightAdjustmentScale = Math.max(
      options?.maximumWeightAdjustmentScale ?? 10,
      0,
    );

    this.limitBiasScale = Math.max(options?.limitBiasScale ?? 10_000, 1);

    this.limitWeightScale = Math.max(options?.limitWeightScale ?? 100_000, 1);

    this.learningRate = Math.min(
      Math.max(
        options?.learningRate ?? Math.random(),
        0.01,
      ),
      1,
    );

    this.disableExponentialScaling = options?.disableExponentialScaling;

    this.plankConstant = options?.plankConstant ?? 0.000_000_1;
  }
}

export function adjustedBias(
  node: Neuron,
  config: BackPropagationConfig,
): number {
  if (node.type == "constant") {
    return node.bias;
  } else {
    const ns = node.creature.state.node(node.index);

    if (ns.count) {
      const totalValue = ns.totalValue + (node.bias * config.generations);
      const samples = ns.count + config.generations;

      const averageDifferenceBias = (totalValue - ns.totalWeightedSum) /
        samples;

      const unaccountedRatioBias = 1 - (totalValue / ns.totalWeightedSum);

      if (
        config.useAverageDifferenceBias == "Yes" ||
        Number.isFinite(unaccountedRatioBias) == false
      ) {
        if (Number.isFinite(averageDifferenceBias)) {
          return limitBias(averageDifferenceBias, node.bias, config);
        }
      } else if (
        config.useAverageDifferenceBias == "No" ||
        (
          Math.abs(averageDifferenceBias - node.bias) <
            Math.abs(unaccountedRatioBias - node.bias)
        )
      ) {
        return limitBias(unaccountedRatioBias, node.bias, config);
      } else {
        return limitBias(averageDifferenceBias, node.bias, config);
      }
    }

    return node.bias;
  }
}

export function limitActivationToRange(node: Neuron, activation: number) {
  if (node.type == "input" || node.type == "constant") {
    return activation;
  }
  const squash = node.findSquash();
  const unSquasher = squash;
  const range = unSquasher.range();

  const propagateUpdateMethod = squash as NeuronActivationInterface;
  if (propagateUpdateMethod.propagate !== undefined) {
    const value = activation - node.bias;

    const limitedActivation = Math.min(
      Math.max(value, range.low),
      range.high,
    ) + node.bias;

    return limitedActivation;
  } else {
    const limitedActivation = Math.min(
      Math.max(activation, range.low),
      range.high,
    );

    return limitedActivation;
  }
}

export function toValue(neuron: Neuron, activation: number, hint?: number) {
  if (neuron.type == "input" || neuron.type == "constant") {
    return activation;
  }
  const squash = neuron.findSquash();
  const unSquash = (squash as UnSquashInterface).unSquash;
  if (unSquash !== undefined) {
    const value = unSquash.call(squash, activation, hint);

    return limitValue(value);
  } else {
    return activation;
  }
}
export function toActivation(neuron: Neuron, value: number) {
  const squash = neuron.findSquash();

  const squashedActivation = (squash as ActivationInterface).squash(
    value,
  );

  return limitActivation(squashedActivation);
}

export function accumulateWeight(
  weight: number,
  cs: SynapseState,
  value: number,
  activation: number,
  config: BackPropagationConfig,
) {
  if (
    !Number.isFinite(weight) ||
    !Number.isFinite(value) ||
    !Number.isFinite(activation)
  ) {
    throw new Error(
      `Invalid weight: ${weight}, value: ${value}, activation: ${activation}`,
    );
  }
  if (Math.abs(activation) > config.plankConstant) {
    const targetWeight = value / activation;

    let difference = targetWeight - weight;

    if (!config.disableExponentialScaling) {
      // Squash the difference using the hyperbolic tangent function and scale it
      difference = Math.tanh(difference / config.maximumWeightAdjustmentScale) *
        config.maximumWeightAdjustmentScale;
    } else if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
      // Limit the difference to the maximum scale
      difference = Math.sign(difference) * config.maximumWeightAdjustmentScale;
    }

    const adjustedWeight = weight + difference;

    cs.averageWeight = ((cs.averageWeight * cs.count) + adjustedWeight) /
      (cs.count + 1);

    cs.count++;
  }
}

export function adjustedWeight(
  creatureState: CreatureState,
  c: Synapse,
  config: BackPropagationConfig,
) {
  const cs = creatureState.connection(c.from, c.to);

  if (cs.count) {
    if (Number.isFinite(cs.averageWeight)) {
      const synapseAverageWeightTotal = cs.averageWeight * cs.count;

      const totalGenerationalWeight = c.weight * config.generations;

      const averageWeight =
        (synapseAverageWeightTotal + totalGenerationalWeight) /
        (cs.count + config.generations);

      return limitWeight(averageWeight, c.weight, config);
    } else {
      throw Error(
        `${c.from}:${c.to}) invalid averageWeight: ${cs.averageWeight} ` +
          JSON.stringify(cs, null, 2),
      );
    }
  }

  return c.weight;
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

export function limitWeight(
  targetWeight: number,
  currentWeight: number,
  config: BackPropagationConfig,
) {
  if (Math.abs(targetWeight) < config.plankConstant) {
    return 0;
  }

  if (!Number.isFinite(currentWeight)) {
    if (Number.isFinite(targetWeight)) {
      throw new Error(
        `Invalid current: ${currentWeight} returning target: ${targetWeight}`,
      );
    } else {
      throw new Error(
        `Invalid current: ${currentWeight} and target: ${targetWeight} returning zero`,
      );
    }
  }
  if (!Number.isFinite(targetWeight)) {
    throw new Error(
      `Invalid target: ${targetWeight} returning current ${currentWeight}`,
    );
  }

  const difference = config.learningRate * (targetWeight - currentWeight);
  let limitedWeight = currentWeight + difference;
  if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
    if (difference > 0) {
      limitedWeight = currentWeight + config.maximumWeightAdjustmentScale;
    } else {
      limitedWeight = currentWeight - config.maximumWeightAdjustmentScale;
    }
  }
  if (Math.abs(limitedWeight) >= config.limitWeightScale) {
    if (limitedWeight > 0) {
      if (limitedWeight > currentWeight) {
        limitedWeight = Math.max(currentWeight, config.limitWeightScale);
      }
    } else {
      if (limitedWeight < currentWeight) {
        limitedWeight = Math.min(currentWeight, config.limitWeightScale * -1);
      }
    }
  }

  return limitedWeight;
}

export function limitActivation(activation: number) {
  if (activation > 1e12) return 1e12;
  if (activation < -1e12) return -1e12;

  return activation;
}

export function limitValue(value: number) {
  if (value > 1e12) return 1e12;
  if (value < -1e12) return -1e12;

  return value;
}
