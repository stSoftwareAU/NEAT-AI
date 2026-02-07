/**
 * Configuration for adaptive quantum step sizing during memetic fine-tuning.
 *
 * Issue #1330: The quantum step size used in fine-tuning was a fixed constant.
 * Adaptive step sizing based on training progress improves convergence -
 * larger steps when far from optimum, smaller steps when fine-tuning.
 *
 * The effective step size is calculated as:
 *   effectiveStep = baseStep * (1 + errorScale * normalisedError)
 *
 * where normalisedError is derived from the score improvement between the
 * current and previous best creature.
 */

/**
 * Configuration for quantum step sizing behaviour.
 */
export interface QuantumStepConfig {
  /**
   * The minimum quantum step size.
   * This is the floor for step sizing - the step will never go below this.
   * Default: 0.000_000_1 (1e-7)
   */
  minStep?: number;

  /**
   * The maximum quantum step size.
   * This is the ceiling for step sizing - the step will never exceed this.
   * Default: 0.001 (1e-3)
   */
  maxStep?: number;

  /**
   * Scale factor controlling how much the error magnitude influences step size.
   * Higher values mean larger errors produce proportionally larger steps.
   * 0 = fixed step (no adaptation), higher = more aggressive adaptation.
   * Default: 10
   */
  errorScale?: number;
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
  maxStep: 0.001,
  errorScale: 10,
};
