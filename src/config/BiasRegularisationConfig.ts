/**
 * Configuration for bias regularisation during mutation.
 *
 * Issue #1416: Evolve towards "safe" biases by regularising bias mutations
 * to prevent extreme values that cause exploding activations.
 *
 * This mirrors the weight regularisation approach from Issue #1309, applying
 * the same principles to neuron biases.
 */

/**
 * Configuration for bias regularisation behaviour.
 */
export interface BiasRegularisationConfig {
  /**
   * Whether bias regularisation is enabled.
   * When disabled, bias mutations proceed without regularisation.
   * Default: true (opt-in via sensible defaults)
   */
  enabled?: boolean;

  /**
   * Maximum absolute bias value allowed.
   * Biases exceeding this magnitude are clamped.
   * Set to Infinity to disable hard limiting.
   * Default: 100
   */
  maxAbsoluteBias?: number;

  /**
   * Maximum bias change allowed per mutation.
   * Limits how much a single mutation can modify a bias.
   * Set to Infinity to disable change limiting.
   * Default: 10
   */
  maxBiasChange?: number;

  /**
   * L2 regularisation strength (0-1).
   * Higher values penalise large bias magnitudes more strongly,
   * biasing mutations towards smaller biases.
   * 0 = no regularisation, 1 = strong regularisation
   * Default: 0.1
   */
  l2Strength?: number;

  /**
   * Whether to prefer smaller bias changes over large jumps.
   * When enabled, the mutation distribution is biased towards
   * smaller modifications.
   * Default: true
   */
  preferSmallChanges?: boolean;

  /**
   * Scale factor for small change preference (0-1).
   * Lower values make the bias towards small changes stronger.
   * Only applies when preferSmallChanges is true.
   * Default: 0.5
   */
  smallChangeScale?: number;
}

/**
 * Required version of BiasRegularisationConfig with all fields populated.
 */
export type RequiredBiasRegularisationConfig = Required<
  BiasRegularisationConfig
>;

/**
 * Default values for bias regularisation configuration.
 */
export const DEFAULT_BIAS_REGULARISATION_CONFIG:
  RequiredBiasRegularisationConfig = {
    enabled: true,
    maxAbsoluteBias: 100,
    maxBiasChange: 10,
    l2Strength: 0.1,
    preferSmallChanges: true,
    smallChangeScale: 0.5,
  };
