/**
 * Configuration for adaptive quantum step size during memetic fine-tuning.
 *
 * Issue #1330: Configurable quantum step size based on training progress.
 *
 * The quantum step size controls the minimum granularity of weight/bias
 * adjustments during fine-tuning. Adaptive step sizing uses larger steps
 * when far from the optimum and smaller steps when fine-tuning near
 * convergence.
 *
 * The effective step is calculated as:
 *   effectiveStep = minStep * (1 + scaleFactor * normalisedError)
 *
 * where normalisedError is clamped to [0, 1] based on the score improvement
 * between the fittest and previous fittest creatures.
 */

/**
 * Configuration for quantum step size behaviour.
 */
export interface QuantumStepConfig {
  /**
   * Minimum quantum step size (lower bound).
   * This is the finest granularity used when close to convergence.
   * Default: 0.000_000_1
   */
  minStep?: number;

  /**
   * Maximum quantum step size (upper bound).
   * This is the coarsest granularity used when far from the optimum.
   * Default: 0.000_1
   */
  maxStep?: number;

  /**
   * Scale factor controlling how strongly the error magnitude
   * influences step size. Higher values produce larger steps when
   * the error is large.
   * Default: 10
   */
  scaleFactor?: number;
}

/**
 * Required version of QuantumStepConfig with all fields populated.
 */
export type RequiredQuantumStepConfig = Required<QuantumStepConfig>;

/**
 * Default values for quantum step configuration.
 */
export const DEFAULT_QUANTUM_STEP_CONFIG: RequiredQuantumStepConfig = {
  minStep: 0.000_000_1,
  maxStep: 0.000_1,
  scaleFactor: 10,
};
