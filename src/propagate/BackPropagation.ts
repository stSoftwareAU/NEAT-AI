import type { Neuron } from "../architecture/Neuron.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import type { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";

type BackPropagationArguments = {
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
};

export type BackPropagationOptions = Partial<BackPropagationArguments>;

export type BackPropagationConfig = Readonly<BackPropagationArguments>;

export function createBackPropagationConfig(
  options?: BackPropagationOptions | BackPropagationConfig,
): BackPropagationConfig {
  const config: BackPropagationArguments = {
    disableRandomSamples: options?.disableRandomSamples ?? false,

    generations: Math.max(
      options?.generations ?? Math.floor(Math.random() * 100) + 1,
      0,
    ),

    maximumBiasAdjustmentScale: Math.max(
      options?.maximumBiasAdjustmentScale ?? 10,
      0,
    ),

    maximumWeightAdjustmentScale: Math.max(
      options?.maximumWeightAdjustmentScale ?? 10,
      0,
    ),

    limitBiasScale: Math.max(options?.limitBiasScale ?? 10_000, 1),

    limitWeightScale: Math.max(options?.limitWeightScale ?? 100_000, 1),

    learningRate: Math.min(
      Math.max(
        options?.learningRate ?? Math.random(),
        0.01,
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
  };

  return Object.freeze(config);
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
  squash.range.validate(squashedActivation);
  return squashedActivation;
}

export function limitValue(value: number) {
  if (value > 1e12) return 1e12;
  if (value < -1e12) return -1e12;

  return value;
}
