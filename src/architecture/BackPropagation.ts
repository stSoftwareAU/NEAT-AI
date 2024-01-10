import { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import { ConnectionInternal } from "./ConnectionInterfaces.ts";
import { ConnectionState, NetworkState } from "./NetworkState.ts";
import { Node } from "./Node.ts";

export interface BackPropagationOptions {
  useAverageWeight?: "Yes" | "No" | "Maybe";
  disableRandomSamples?: boolean;
  useAverageDifferenceBias?: "Yes" | "No" | "Maybe";

  /**
   * The amount of previous generations if not set it'll be a random number between 1-100.
   * The higher number of generations the lower the learning rate
   */
  generations?: number;

  /**
   * The maximum +/- the bias will be adjusted in one training iteration. Default 0.1, Minimum 0.1
   */
  maximumBiasAdjustmentScale?: number;

  /**
   * The maximum +/- the weight will be adjusted in one training iteration. Default 0.1, Minimum 0.1
   */
  maximumWeightAdjustmentScale?: number;

  /**
   * The limit +/- of the bias, training will not adjust beyound this scale. Default 10, Minimum 1
   */
  limitBiasScale?: number;

  /**
   * The limit +/- of the weight, training will not adjust beyound this scale. Default 10, Minimum 1
   */
  limitWeightScale?: number;
}

export const MAX_WEIGHT = 100_000;
export const MIN_WEIGHT = 1e-12;

export const PLANK_CONSTANT = 0.000_000_1;

export const MAX_BIAS = 100_000;

export class BackPropagationConfig implements BackPropagationOptions {
  public useAverageWeight: "Yes" | "No" | "Maybe";
  public disableRandomSamples: boolean;

  public useAverageDifferenceBias: "Yes" | "No" | "Maybe";
  public generations: number;

  maximumBiasAdjustmentScale: number;

  maximumWeightAdjustmentScale: number;

  limitBiasScale: number;

  limitWeightScale: number;
  constructor(options?: BackPropagationOptions) {
    const random = Math.random() * 2 - 1;
    this.useAverageWeight = options?.useAverageWeight
      ? options?.useAverageWeight
      : random > 0.75
      ? "Yes"
      : random < -0.75
      ? "No"
      : "Maybe";
    // this.useAverageValuePerActivation = options?.useAverageValuePerActivation ??
    //   Math.random() > 0.5;
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
      options?.maximumBiasAdjustmentScale ?? 0,
      0.1,
    );

    this.maximumWeightAdjustmentScale = Math.max(
      options?.maximumWeightAdjustmentScale ?? 0,
      0.1,
    );

    this.limitBiasScale = Math.max(options?.limitBiasScale ?? 10, 1);

    this.limitWeightScale = Math.max(options?.limitWeightScale ?? 10, 1);
  }
}

export function adjustedBias(
  node: Node,
  config: BackPropagationConfig,
): number {
  if (node.type == "constant") {
    return node.bias ? node.bias : 0;
  } else {
    const ns = node.network.networkState.node(node.index);

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
        return limitBias(averageDifferenceBias, node.bias, config);
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
    } else {
      return node.bias;
    }
  }
}

export function limitActivationToRange(node: Node, activation: number) {
  if (node.type == "input" || node.type == "constant") {
    return activation;
  }
  const squash = node.findSquash();
  const unSquasher = squash;
  const range = unSquasher.range();
  const limitedActivation = Math.min(
    Math.max(activation, range.low),
    range.high,
  );

  return limitedActivation;
}

export function toValue(node: Node, activation: number) {
  if (node.type == "input" || node.type == "constant") {
    return activation;
  }
  const squash = node.findSquash();
  if (((squash as unknown) as UnSquashInterface).unSquash != undefined) {
    const unSquasher = (squash as unknown) as UnSquashInterface;
    const value = unSquasher.unSquash(activation);

    if (!Number.isFinite(value)) {
      throw new Error(
        `${node.index}: ${node.squash}.unSquash(${activation}) invalid -> ${value}`,
      );
    }
    return limitValue(value);
  } else {
    return activation;
  }
}

export function adjustWeight(
  cs: ConnectionState,
  value: number,
  activation: number,
) {
  cs.totalValue += value;
  cs.totalActivation += activation;
  cs.absoluteActivation += Math.abs(activation);
  cs.count++;
}

export function adjustedWeight(
  networkState: NetworkState,
  c: ConnectionInternal,
  config: BackPropagationConfig,
) {
  const cs = networkState.connection(c.from, c.to);

  if (cs.count && Math.abs(cs.totalActivation) > PLANK_CONSTANT) {
    const synapseAverageWeightTotal = (cs.totalValue / cs.totalActivation) *
      cs.count;

    const totalGenerationalWeight = c.weight * config.generations;

    const averageWeight =
      (synapseAverageWeightTotal + totalGenerationalWeight) /
      (cs.count + config.generations);

    if (config.useAverageWeight == "Yes") {
      return limitWeight(averageWeight, c.weight, config);
    }

    const totalValue = cs.totalValue + (c.weight * config.generations);
    const absoluteActivation = cs.absoluteActivation + config.generations;
    const absoluteWeight = totalValue / absoluteActivation;

    if (config.useAverageWeight == "Maybe") {
      if (
        Math.abs(averageWeight - c.weight) <=
          Math.abs(absoluteWeight - c.weight)
      ) {
        return limitWeight(averageWeight, c.weight, config);
      } else {
        return limitWeight(absoluteWeight, c.weight, config);
      }
    } else {
      return limitWeight(absoluteWeight, c.weight, config);
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
  const adjustedBias = Math.max(-MAX_BIAS, Math.min(MAX_BIAS, targetBias));

  const difference = adjustedBias - currentBias;
  let limitedBias = adjustedBias;
  if (Math.abs(limitedBias) <= config.limitBiasScale) {
    if (Math.abs(difference) > config.maximumBiasAdjustmentScale) {
      if (difference > 0) {
        limitedBias = currentBias + config.maximumBiasAdjustmentScale;
      } else {
        limitedBias = currentBias - config.maximumBiasAdjustmentScale;
      }
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
  weight: number,
  currentWeight: number,
  config: BackPropagationConfig,
) {
  if (Math.abs(weight) < MIN_WEIGHT) {
    return 0;
  }

  const adjustedWeight = Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, weight));

  const difference = adjustedWeight - currentWeight;
  let limitedWeight = adjustedWeight;
  if (Math.abs(limitedWeight) <= config.limitWeightScale) {
    if (Math.abs(difference) > config.maximumWeightAdjustmentScale) {
      if (difference > 0) {
        limitedWeight = currentWeight + config.maximumWeightAdjustmentScale;
      } else {
        limitedWeight = currentWeight - config.maximumWeightAdjustmentScale;
      }
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
