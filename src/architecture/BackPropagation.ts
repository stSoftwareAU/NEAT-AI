import { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import { ConnectionInternal } from "./ConnectionInterfaces.ts";
import { NetworkState } from "./NetworkState.ts";
import { Node } from "./Node.ts";

export interface BackPropagationOptions {
  useAverageValuePerActivation?: boolean;
  disableRandomList?: boolean;
  useAverageDifferenceBias?: "Yes" | "No" | "Maybe";

  /**
   * The amount of previous generations if not set it'll be a random number between 1-100.
   * The higher number of generations the lower the learning rate
   */
  generations?: number;
}

export const MAX_WEIGHT = 100_000;
export const MIN_WEIGHT = 1e-12;

export const MAX_BIAS = 100_000;

export class BackPropagationConfig implements BackPropagationOptions {
  public useAverageValuePerActivation: boolean;
  public disableRandomList: boolean;

  public useAverageDifferenceBias: "Yes" | "No" | "Maybe";
  public generations: number;

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
      this.useAverageDifferenceBias = "Yes";
      // const random = Math.random() * 2 - 1;
      // this.useAverageDifferenceBias = random > 0.75
      //   ? "Yes"
      //   : random < -0.75
      //   ? "No"
      //   : "Maybe";
    }

    this.generations = Math.max(
      options?.generations ?? Math.floor(Math.random() * 100) + 1,
      0,
    );
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

export function limitActivationToRange(node: Node, activation: number) {
  if (node.type == "input" || node.type == "constant") {
    return activation;
  }
  const squash = node.findSquash();
  if ((squash as UnSquashInterface).range !== undefined) {
    const unSquasher = squash as UnSquashInterface;
    const range = unSquasher.range();
    const limitedActivation = Math.min(
      Math.max(activation, range.low),
      range.high,
    );

    // if (limitedActivation !== activation) {
    //   console.info(
    //     `${node.index}: limitActivationToRange(${activation}) squash: ${squash.getName()} -> ${limitedActivation}`,
    //   );
    // }
    return limitedActivation;
  }

  return activation;
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

export function adjustedWeight(
  networkState: NetworkState,
  c: ConnectionInternal,
  config: BackPropagationConfig,
) {
  const cs = networkState.connection(c.from, c.to);

  if (cs.totalActivation) {
    const totalValue = cs.totalValue + (c.weight * config.generations);

    const totalActivation = cs.totalActivation + config.generations;
    const absoluteActivation = cs.absoluteActivation + config.generations;

    const averageWeightPerActivation = totalValue / totalActivation;
    const averageWeightPerAbsoluteActivation = totalValue / absoluteActivation;

    if (config.useAverageValuePerActivation) {
      if (Number.isFinite(averageWeightPerActivation)) {
        return limitWeight(averageWeightPerActivation);
      } else {
        console.info(
          `${c.to}: Invalid Weight : averageValuePerActivation ${averageWeightPerActivation}`,
        );
        return limitWeight(c.weight);
      }
    } else {
      return limitWeight(averageWeightPerAbsoluteActivation);
    }
  } else {
    return limitWeight(c.weight);
  }
}

export function limitBias(bias: number) {
  if (!Number.isFinite(bias)) {
    throw new Error(`Bias must be a finite number, got ${bias}`);
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
