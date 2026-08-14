/**
 * Decide whether a training result is a real regression versus the fitness
 * error, or just evaluate-noise.
 *
 * Fitness error is tagged from `evaluateDir` (WASM). Training `bestError`
 * comes from the backprop epoch loop. On a 4-sample AND they disagree at
 * ~1e-9 (f32 accumulation). `r.train.error > fitnessError` treated that as
 * a rollback; Issue #2382 then skipped further training after two such
 * "regressions", so memetic evolution died and `evolve_AND_gate` could sit
 * at error ~0.07 for tens of thousands of generations.
 */

/** Absolute floor — covers f32/f64 evaluate disagreement on small datasets. */
export const TRAINING_ERROR_REGRESSION_ABS = 1e-7;

/** Relative floor — scales with larger errors. */
export const TRAINING_ERROR_REGRESSION_REL = 1e-6;

/**
 * True when `trainedError` is materially worse than `fitnessError`.
 * Equal or better, non-finite fitness, or a delta inside the noise floor
 * is not a regression.
 */
export function isTrainingErrorRegression(
  trainedError: number,
  fitnessError: number,
): boolean {
  if (!Number.isFinite(trainedError)) {
    return true;
  }
  if (!Number.isFinite(fitnessError)) {
    return false;
  }
  const delta = trainedError - fitnessError;
  if (delta <= 0) {
    return false;
  }
  const tolerance = Math.max(
    TRAINING_ERROR_REGRESSION_ABS,
    Math.abs(fitnessError) * TRAINING_ERROR_REGRESSION_REL,
  );
  return delta > tolerance;
}
