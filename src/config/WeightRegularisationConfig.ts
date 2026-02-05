/**
 * Configuration for weight regularisation during mutation.
 *
 * Issue #1309: Reduce brittleness: Weight regularisation during mutation.
 *
 * This configuration controls how weight mutations are regularised to prevent
 * extreme values that cause brittleness.
 */

/**
 * Configuration for weight regularisation behaviour.
 */
export interface WeightRegularisationConfig {
  /**
   * Whether weight regularisation is enabled.
   * When disabled, weight mutations proceed without regularisation.
   * Default: true (opt-in via sensible defaults)
   */
  enabled?: boolean;

  /**
   * Maximum absolute weight value allowed.
   * Weights exceeding this magnitude are clamped.
   * Set to Infinity to disable hard limiting.
   * Default: 100
   */
  maxAbsoluteWeight?: number;

  /**
   * Maximum weight change allowed per mutation.
   * Limits how much a single mutation can modify a weight.
   * Set to Infinity to disable change limiting.
   * Default: 10
   */
  maxWeightChange?: number;

  /**
   * L2 regularisation strength (0-1).
   * Higher values penalise large weight magnitudes more strongly,
   * biasing mutations towards smaller weights.
   * 0 = no regularisation, 1 = strong regularisation
   * Default: 0.1
   */
  l2Strength?: number;

  /**
   * Whether to prefer smaller weight changes over large jumps.
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
 * Required version of WeightRegularisationConfig with all fields populated.
 */
export type RequiredWeightRegularisationConfig = Required<
  WeightRegularisationConfig
>;

/**
 * Default values for weight regularisation configuration.
 */
export const DEFAULT_WEIGHT_REGULARISATION_CONFIG:
  RequiredWeightRegularisationConfig = {
    enabled: true,
    maxAbsoluteWeight: 100,
    maxWeightChange: 10,
    l2Strength: 0.1,
    preferSmallChanges: true,
    smallChangeScale: 0.5,
  };
