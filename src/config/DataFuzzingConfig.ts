/**
 * Configuration for training data fuzzing (noise injection).
 *
 * Issue #1900: Noise injection is a standard regularisation technique
 * that prevents networks from memorising exact training examples by
 * adding small perturbations to training data during each iteration.
 */

/**
 * Configuration for data fuzzing behaviour during training.
 */
export interface DataFuzzingConfig {
  /** Whether data fuzzing is active. Default: false. */
  enabled?: boolean;

  /**
   * Standard deviation (Gaussian) or half-width (uniform) of noise
   * added to input observations.
   * Default: 0.01. Range: 0..1.
   */
  inputNoiseScale?: number;

  /**
   * Optional noise on target outputs (0 = disabled).
   * Small values provide label smoothing.
   * Default: 0. Range: 0..1.
   */
  outputNoiseScale?: number;

  /**
   * Distribution used for noise generation.
   * Default: "gaussian".
   */
  noiseType?: "gaussian" | "uniform";
}

/**
 * Required version with all fields populated.
 */
export type RequiredDataFuzzingConfig = Required<DataFuzzingConfig>;

/**
 * Default values for data fuzzing configuration.
 */
export const DEFAULT_DATA_FUZZING_CONFIG: RequiredDataFuzzingConfig = {
  enabled: false,
  inputNoiseScale: 0.01,
  outputNoiseScale: 0,
  noiseType: "gaussian",
};
