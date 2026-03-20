/**
 * Configuration for training data quantisation.
 *
 * Issue #1901: Quantisation rounds continuous values to a finite set of
 * discrete levels, forcing the network to learn robust mappings rather
 * than memorising exact training examples. Unlike fuzzing (#1900),
 * quantisation is deterministic — the same input always maps to the
 * same quantised value.
 */

/**
 * Configuration for data quantisation behaviour during training.
 */
export interface DataQuantisationConfig {
  /** Whether data quantisation is active. Default: false. */
  enabled?: boolean;

  /**
   * Number of discrete quantisation levels for input values.
   * Default: 256 (approximately 8-bit precision).
   * Range: 2..65536.
   */
  inputLevels?: number;

  /**
   * Quantisation levels for target outputs.
   * 0 = disabled (preserves exact targets).
   * When > 0, must be in range 2..65536.
   * Default: 0.
   */
  outputLevels?: number;
}

/**
 * Required version with all fields populated.
 */
export type RequiredDataQuantisationConfig = Required<DataQuantisationConfig>;

/**
 * Default values for data quantisation configuration.
 */
export const DEFAULT_DATA_QUANTISATION_CONFIG: RequiredDataQuantisationConfig =
  {
    enabled: false,
    inputLevels: 256,
    outputLevels: 0,
  };
