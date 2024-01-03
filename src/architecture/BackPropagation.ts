import { Node } from "./Node.ts";

export interface BackPropagationOptions {
  useAverageValuePerActivation?: boolean;
  disableRandomList?: boolean;
  useAverageDifferenceBias?: "Yes" | "No" | "Maybe";
  // @TODO implement generations
}

export const MAX_WEIGHT = 100_000;
export const MIN_WEIGHT = 1e-12;

export const MAX_BIAS = 100_000;

export class BackPropagationConfig implements BackPropagationOptions {
  public useAverageValuePerActivation: boolean;
  public disableRandomList: boolean;

  public useAverageDifferenceBias: "Yes" | "No" | "Maybe";

  constructor(options?: BackPropagationOptions) {
    this.useAverageValuePerActivation = options?.useAverageValuePerActivation ??
      Math.random() > 0.5;
    this.disableRandomList = options?.disableRandomList ?? false;
    if (
      options?.useAverageDifferenceBias === "Yes" ||
      options?.useAverageDifferenceBias === "No" ||
      options?.useAverageDifferenceBias === "Maybe"
    ) {
      this.useAverageDifferenceBias = options?.useAverageDifferenceBias;
    } else {
      const random = Math.random() * 2 - 1;
      this.useAverageDifferenceBias = random > 0.75
        ? "Yes"
        : random < -0.75
        ? "No"
        : "Maybe";
    }
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
      const averageDifferenceBias = (ns.totalValue - ns.totalWeightedSum) /
        ns.count;

      const unaccountedRatioBias = 1 - (ns.totalValue / ns.totalWeightedSum);

      if (
        config.useAverageDifferenceBias == "Yes" ||
        Number.isFinite(unaccountedRatioBias) == false
      ) {
        return limitBias(averageDifferenceBias);
      } else if (
        config.useAverageDifferenceBias == "No" ||
        (
          Math.abs(averageDifferenceBias - node.bias) <
            Math.abs(unaccountedRatioBias - node.bias)
        )
      ) {
        return limitBias(unaccountedRatioBias);
      } else {
        return limitBias(averageDifferenceBias);
      }
    } else {
      return limitBias(node.bias);
    }
  }
}

export function limitBias(bias: number) {
  if (!Number.isFinite(bias)) {
    console.trace();
    throw `Bias must be a finite number, got ${bias}`;
  }
  return Math.max(-MAX_BIAS, Math.min(MAX_BIAS, bias));
}

export function limitWeight(weight: number) {
  if (Math.abs(weight) < MIN_WEIGHT) {
    return 0;
  }

  return Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, weight));
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
