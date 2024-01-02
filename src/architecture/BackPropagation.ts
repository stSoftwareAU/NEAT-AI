export interface BackPropagationOptions {
  useAverageValuePerActivation?: boolean;
  disableRandomList?: boolean;
  useAverageDifferenceBias?: "Yes" | "No" | "Maybe";
  // @TODO implement generations
}

export const MAX_WEIGHT = 100_000;
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

export function limitBias(bias: number) {
  if (!Number.isFinite(bias)) {
    throw `Bias must be a finite number, got ${bias}`;
  }
  return Math.max(-MAX_BIAS, Math.min(MAX_BIAS, bias));
}

export function limitWeight(weight: number) {
  if (!Number.isFinite(weight)) {
    throw `Weight must be a finite number, got ${weight}`;
  }

  return Math.max(-MAX_WEIGHT, Math.min(MAX_WEIGHT, weight));
}

export function limitActivation(activation: number) {
  if (activation > 1e100) return 1e100;
  if (activation < -1e100) return -1e100;

  return activation;
}
