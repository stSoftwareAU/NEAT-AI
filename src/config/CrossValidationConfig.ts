/**
 * Configuration for k-fold cross-validation during fitness evaluation.
 *
 * Issue #1865: Cross-validation improves generalisation by evaluating
 * creatures on held-out data folds during evolution, reducing overfitting
 * to a single train/test split.
 */

/**
 * Configuration for k-fold cross-validation behaviour.
 */
export interface CrossValidationConfig {
  /** Whether cross-validation is enabled. Default: false. */
  enabled?: boolean;

  /**
   * Number of folds for k-fold cross-validation.
   * k=1 preserves existing single-split behaviour (backward compatible).
   * Default: 5. Range: 1..20.
   */
  folds?: number;

  /**
   * Whether to use validation fold performance for early stopping
   * during backpropagation instead of training error.
   * Default: true (when cross-validation is enabled).
   */
  validationEarlyStopping?: boolean;
}

/**
 * Required version with all fields populated.
 */
export type RequiredCrossValidationConfig = Required<CrossValidationConfig>;

/**
 * Default values for cross-validation configuration.
 */
export const DEFAULT_CROSS_VALIDATION_CONFIG: RequiredCrossValidationConfig = {
  enabled: false,
  folds: 5,
  validationEarlyStopping: true,
};
