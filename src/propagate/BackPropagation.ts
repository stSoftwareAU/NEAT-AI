import type { Neuron } from "../architecture/Neuron.ts";
import type { AbstractActivationInterface } from "../methods/activations/AbstractActivationInterface.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import type { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";

export type BackPropagationArguments = {
  disableRandomSamples: boolean;

  /**
   * The amount of previous generations if not set it'll be a random number between 1-100.
   * The higher number of generations the lower the learning rate
   */
  generations: number;

  /**
   * The learning rate. Between 0..1, Default random number.
   */
  learningRate: number;

  /**
   * The maximum +/- the bias will be adjusted in one training iteration. Default 10, Minimum 0.1
   */
  maximumBiasAdjustmentScale: number;

  /**
   * The maximum +/- the weight will be adjusted in one training iteration. Default 10, Minimum 0.1
   */
  maximumWeightAdjustmentScale: number;

  /**
   * The limit +/- of the bias, training will not adjust beyond this scale. Default 10_000, Minimum 1
   */
  limitBiasScale: number;

  /**
   * The limit +/- of the weight, training will not adjust beyond this scale. Default 100_000, Minimum 1
   */
  limitWeightScale: number;

  /** the minimum unit of weights/biases */
  plankConstant: number;

  /** Probability of changing a gene */
  trainingMutationRate: number;

  /** Disable Bias adjustment */
  disableBiasAdjustment: boolean;

  /** Disable weight adjustment */
  disableWeightAdjustment: boolean;

  /** The number of samples per batch */
  batchSize: number;

  /** Determine how many neurons to select based on the sparseRatio. */
  sparseRatio: number;

  /**
   * If true, the derivative propagation will be used. This is a more advanced method of back propagation
   * that can lead to better results, but it is also more complex and slower.
   */
  useDerivativePropagation: boolean;
};

export type BackPropagationOptions = Partial<BackPropagationArguments>;

export type BackPropagationConfig = Readonly<BackPropagationArguments>;

export function createBackPropagationConfig(
  options?: BackPropagationOptions,
): BackPropagationConfig {
  const config: BackPropagationArguments = {
    disableRandomSamples: options?.disableRandomSamples ?? false,

    generations: Math.max(
      options?.generations ?? Math.floor(Math.random() * 100) + 1,
      0,
    ),

    maximumBiasAdjustmentScale: Math.max(
      options?.maximumBiasAdjustmentScale ?? 1,
      0,
    ),

    maximumWeightAdjustmentScale: Math.max(
      options?.maximumWeightAdjustmentScale ?? 1,
      0,
    ),

    limitBiasScale: Math.max(options?.limitBiasScale ?? 10_000, 1),

    limitWeightScale: Math.max(options?.limitWeightScale ?? 100_000, 1),

    learningRate: Math.min(
      Math.max(
        options?.learningRate ??
          Math.random() * Math.random() *
            Math
              .random(), /* Random number between 0..1 but on the lower side */
        0.001,
      ),
      1,
    ),

    trainingMutationRate: Math.min(
      Math.max(
        options?.trainingMutationRate ?? Math.random(),
        0.01,
      ),
      1,
    ),

    plankConstant: options?.plankConstant ?? 0.000_000_1,

    disableBiasAdjustment: options?.disableBiasAdjustment ?? false,
    disableWeightAdjustment: options?.disableWeightAdjustment ?? false,
    batchSize: options?.batchSize ?? 1,
    sparseRatio: options?.sparseRatio ?? 1,
    useDerivativePropagation: options?.useDerivativePropagation ?? false,
  };

  return Object.freeze(config);
}

export function toValue(neuron: Neuron, activation: number, hint?: number) {
  if (neuron.type === "input" || neuron.type === "constant") {
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
  squash.range.validate(squashedActivation);
  return squashedActivation;
}

export function limitValue(value: number) {
  if (value > 1e12) return 1e12;
  if (value < -1e12) return -1e12;

  return value;
}

export function calculateDerivativeError(
  squashMethod: AbstractActivationInterface,
  currentActivation: number,
  targetActivation: number,
  hintValue?: number,
): number {
  // Correct derivative-based approach (clear glasses!)
  const rawError = targetActivation - currentActivation;

  // Calculate current raw input value once
  let currentValue = currentActivation;
  const unsquashMethod = squashMethod as UnSquashInterface;
  if (unsquashMethod.unSquash !== undefined) {
    currentValue = unsquashMethod.unSquash(currentActivation, hintValue);
  }

  let safeSlope = squashMethod.derivative!(currentValue);

  if (!Number.isFinite(safeSlope)) {
    console.warn(
      `⚠️ Slope is not finite: ${safeSlope}, squash: ${squashMethod.getName()}, currentValue: ${currentValue}`,
    );
    safeSlope = Math.sign(safeSlope);
  } else if (Math.abs(safeSlope) < 1e-8) {
    safeSlope = 0;
  } else if (Math.abs(safeSlope) > 50) {
    safeSlope = Math.sign(safeSlope) * 50;
  }

  const error = rawError * safeSlope;
  return error;
}
