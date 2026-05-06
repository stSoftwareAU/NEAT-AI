/**
 * OpdConfig.ts - On-Policy Distillation breeding operator configuration
 * (Issue #2528).
 *
 * OPD produces an offspring by distilling the consensus output of K elite
 * parents (teachers) into a freshly-initialised student creature, using
 * on-policy gradient descent on the parents' soft outputs. Mirrors the
 * DeepSeek V4 OPD stage where a single student learns from multiple
 * teachers' full-vocabulary logits.
 *
 * The operator is gated behind `breedRate > 0`. When disabled (default)
 * it is never selected and behaviour is identical to the previous
 * crossover-only breeding path.
 */

/**
 * On-Policy Distillation breeding operator configuration.
 *
 * All fields optional; defaults from {@link DEFAULT_OPD_CONFIG} are
 * applied during {@link createNeatConfig}.
 */
export interface OpdConfig {
  /**
   * Probability per breed call that the OPD operator is selected
   * instead of standard crossover. Range 0..1. Default 0 (disabled).
   */
  breedRate?: number;

  /**
   * Number of elite parents (teachers) used to build the consensus
   * target. K = 1 falls back to a clone-and-train path with a
   * warning. Default 3, minimum 1.
   */
  teacherCount?: number;

  /**
   * Number of backprop steps the student takes against the consensus
   * targets. Default 50, minimum 1.
   */
  distillationSteps?: number;

  /**
   * Number of calibration samples generated per distillation step.
   * Default 16, minimum 1.
   */
  calibrationBatchSize?: number;

  /**
   * Softmax temperature applied to the per-teacher consensus mean.
   * Higher temperatures soften the consensus target. Range > 0.
   * Default 1.0 (no softening — plain mean).
   */
  temperature?: number;

  /**
   * Learning rate used for the distillation backprop steps. Default
   * 0.01, range > 0 and <= 1.
   */
  learningRate?: number;
}

/** Required version of {@link OpdConfig} with all fields populated. */
export type RequiredOpdConfig = Required<OpdConfig>;

/** Default values for {@link OpdConfig}. */
export const DEFAULT_OPD_CONFIG: RequiredOpdConfig = {
  breedRate: 0,
  teacherCount: 3,
  distillationSteps: 50,
  calibrationBatchSize: 16,
  temperature: 1.0,
  learningRate: 0.01,
};
