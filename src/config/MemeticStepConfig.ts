/**
 * Configuration for adaptive quantum step size in memetic fine-tuning.
 *
 * Issue #1330: Configurable quantum step size based on training progress.
 *
 * The quantum step size controls the minimum granularity of weight/bias
 * adjustments during fine-tuning. Adaptive step sizing uses larger steps
 * when far from the optimum and smaller steps when fine-tuning near
 * convergence.
 */

/**
 * Configuration for memetic quantum step size behaviour.
 */
export interface MemeticStepConfig {
  /**
   * Minimum quantum step size. This is the absolute floor for step size,
   * used when the creature is close to convergence.
   * Default: 0.000_000_1
   */
  minStepSize?: number;

  /**
   * Maximum quantum step size. This caps how large the adaptive step can grow.
   * Used when the creature is far from the optimum.
   * Default: 0.001
   */
  maxStepSize?: number;

  /**
   * Scale factor for error-based step size adaptation.
   * Controls how strongly the normalised error magnitude influences step size.
   * Higher values make step size more responsive to error magnitude.
   * Formula: effectiveStep = minStepSize * (1 + errorScale * normalisedError)
   * Default: 10
   */
  errorScale?: number;
}

/**
 * Required version of MemeticStepConfig with all fields populated.
 */
export type RequiredMemeticStepConfig = Required<MemeticStepConfig>;

/**
 * Default values for memetic step size configuration.
 */
export const DEFAULT_MEMETIC_STEP_CONFIG: RequiredMemeticStepConfig = {
  minStepSize: 0.000_000_1,
  maxStepSize: 0.001,
  errorScale: 10,
};
