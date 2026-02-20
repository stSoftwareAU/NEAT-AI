/**
 * Configuration for Predictive Coding (PC) training mode.
 *
 * Issue #1553: Predictive Coding is a neuroscience-inspired learning framework
 * where each layer generates top-down predictions of the layer below, and
 * learning is driven by minimising prediction errors.
 *
 * The inference phase settles latent values by iterating:
 *   x(l) ← x(l) - inferenceRate * dF/dx(l)
 *
 * until the total energy (sum of squared prediction errors) falls below
 * energyThreshold or inferenceSteps is exhausted.
 */

/**
 * Configuration for Predictive Coding behaviour.
 */
export interface PredictiveCodingConfig {
  /** Whether PC training mode is active (default: false). */
  enabled?: boolean;

  /** Number of settling iterations for inference (default: 50). */
  inferenceSteps?: number;

  /** Learning rate for inference updates (default: 0.05). */
  inferenceRate?: number;

  /** Learning rate for weight updates (default: 0.001). */
  learningRate?: number;

  /** Convergence threshold for inference energy (default: 1e-6). */
  energyThreshold?: number;
}

/**
 * Required version of PredictiveCodingConfig with all fields populated.
 */
export type RequiredPredictiveCodingConfig = Required<PredictiveCodingConfig>;

/**
 * Default values for Predictive Coding configuration.
 */
export const DEFAULT_PREDICTIVE_CODING_CONFIG: RequiredPredictiveCodingConfig =
  {
    enabled: false,
    inferenceSteps: 50,
    inferenceRate: 0.05,
    learningRate: 0.001,
    energyThreshold: 1e-6,
  };
