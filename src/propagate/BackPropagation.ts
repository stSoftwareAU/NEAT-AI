import type { Neuron } from "../architecture/Neuron.ts";
// Issue #1143 - WASM backpropagation integration
import {
  squash as wasmSquash,
  unSquash as wasmUnSquash,
} from "../wasm/ActivationMethods.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

export type BackPropagationArguments = {
  disableRandomSamples: boolean;

  /**
   * The amount of previous generations if not set it'll be a random number between 1-10.
   * The higher number of generations the more dampening applied to weight/bias updates.
   * Issue #1436: Reduced from 1-100 and capped in weight/bias calculation to
   * prevent excessive inertia that slows training convergence.
   */
  generations: number;

  /**
   * The learning rate. Between 0..1, Default 0.01.
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

  /** Learning rate strategy: 'fixed', 'decay', 'adaptive', 'warm_restart' */
  learningRateStrategy: "fixed" | "decay" | "adaptive" | "warm_restart";

  /** Initial learning rate for decay/adaptive/warm_restart strategies */
  initialLearningRate: number;

  /** Learning rate decay factor for decay/warm_restart strategies */
  learningRateDecay: number;

  /** Number of iterations between warm restarts. Default 10, minimum 2. */
  warmRestartPeriod: number;
};

export type BackPropagationOptions = Partial<BackPropagationArguments>;

export type BackPropagationConfig = Readonly<BackPropagationArguments>;

export function createBackPropagationConfig(
  options?: BackPropagationOptions,
): BackPropagationConfig {
  const rng = getRandomNumberGenerator();
  const config: BackPropagationArguments = {
    disableRandomSamples: options?.disableRandomSamples ?? false,

    // Issue #1436: Reduce default range from 1-100 to 1-10 to avoid
    // excessive generational dampening that slows training convergence.
    generations: Math.max(
      options?.generations ?? Math.floor(rng.random() * 10) + 1,
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

    // Issue #1437: Use a sensible fixed default (0.01) instead of random()^3
    // which was heavily biased towards tiny values (mean ~0.05).
    learningRate: Math.min(
      Math.max(
        options?.learningRate ?? 0.01,
        0.001,
      ),
      1,
    ),

    trainingMutationRate: Math.min(
      Math.max(
        options?.trainingMutationRate ?? rng.random(),
        0.01,
      ),
      1,
    ),

    plankConstant: options?.plankConstant ?? 0.000_000_1,

    disableBiasAdjustment: options?.disableBiasAdjustment ?? false,
    disableWeightAdjustment: options?.disableWeightAdjustment ?? false,
    batchSize: options?.batchSize ?? 64, // Enable mini-batching by default
    sparseRatio: options?.sparseRatio ?? 1,
    learningRateStrategy: options?.learningRateStrategy ??
      (options?.learningRate !== undefined
        ? "fixed"
        // Issue #1437: Randomise strategy selection including warm_restart
        : (() => {
          const rand = rng.random();
          if (rand < 0.3) return "decay";
          if (rand < 0.55) return "adaptive";
          if (rand < 0.75) return "warm_restart";
          return "fixed";
        })()),
    initialLearningRate: Math.min(
      Math.max(
        options?.initialLearningRate ?? 0.01,
        0.001,
      ),
      1,
    ),
    learningRateDecay: Math.min(
      Math.max(
        options?.learningRateDecay ?? 0.95,
        0.1,
      ),
      1,
    ),
    warmRestartPeriod: Math.max(options?.warmRestartPeriod ?? 10, 2),
  };

  return Object.freeze(config);
}

/**
 * Optional error feedback for the adaptive learning rate strategy.
 * When provided, the adaptive strategy adjusts the learning rate based on
 * whether training is improving, stagnating, or worsening.
 */
export interface ErrorFeedback {
  /** Error from the previous iteration */
  previousError: number;
  /** Error from the current iteration */
  currentError: number;
}

export function calculateLearningRate(
  config: BackPropagationConfig,
  iteration: number,
  errorFeedback?: ErrorFeedback,
): number {
  switch (config.learningRateStrategy) {
    case "fixed":
      return config.learningRate;
    case "decay":
      return config.initialLearningRate *
        Math.pow(config.learningRateDecay, iteration);
    case "adaptive": {
      // Adaptive strategy: adjust learning rate based on actual error feedback.
      // When error is improving => maintain the current rate.
      // When error stagnates  => increase the rate to escape the plateau.
      // When error worsens    => reduce the rate to avoid overshooting.
      const baseRate = config.initialLearningRate;

      // Apply a slower decay than the pure decay strategy
      const adaptiveDecay = Math.sqrt(config.learningRateDecay);
      const adaptiveFactor = Math.pow(adaptiveDecay, iteration);

      let errorAdjustment = 1;
      if (
        errorFeedback &&
        Number.isFinite(errorFeedback.previousError) &&
        Number.isFinite(errorFeedback.currentError) &&
        errorFeedback.previousError > 0
      ) {
        // Ratio of current to previous error: <1 = improving, ~1 = stagnant, >1 = worsening
        const errorRatio = errorFeedback.currentError /
          errorFeedback.previousError;

        if (errorRatio < 0.95) {
          // Good improvement: maintain or slightly boost the rate
          errorAdjustment = 1.1;
        } else if (errorRatio < 1.0) {
          // Stagnation: increase rate to escape plateau
          errorAdjustment = 1.3;
        } else {
          // Error worsened: reduce the rate to avoid overshooting.
          // The worse the ratio, the more we reduce (down to 0.5x).
          errorAdjustment = Math.max(0.5, 1.0 / errorRatio);
        }
      }

      return baseRate * adaptiveFactor * errorAdjustment;
    }
    case "warm_restart": {
      // Issue #1437: Cosine annealing with warm restarts.
      // The learning rate decays within each period, then resets to
      // initialLearningRate at the start of each new period. This helps
      // escape local minima by periodically boosting the learning rate.
      const period = config.warmRestartPeriod;
      const positionInPeriod = iteration % period;
      return config.initialLearningRate *
        Math.pow(config.learningRateDecay, positionInPeriod);
    }
    default:
      return config.learningRate;
  }
}

export function toValue(neuron: Neuron, activation: number, hint?: number) {
  if (neuron.type === "input" || neuron.type === "constant") {
    return activation;
  }

  // Issue #1143 - Use WASM unSquash when available
  if (neuron.squash) {
    const value = wasmUnSquash(neuron.squash, activation, hint);
    return limitValue(value);
  }

  return activation;
}

export function toActivation(neuron: Neuron, value: number) {
  // Issue #1143 - Use WASM squash when available
  const squashedActivation = wasmSquash(neuron.squash!, value);
  const squash = neuron.findSquash();
  squash.range.validate(squashedActivation);
  return squashedActivation;
}

export function limitValue(value: number) {
  if (!Number.isFinite(value)) {
    if (Number.isNaN(value)) return 0;
    return value > 0 ? 1e12 : -1e12;
  }
  if (value > 1e12) return 1e12;
  if (value < -1e12) return -1e12;

  return value;
}
