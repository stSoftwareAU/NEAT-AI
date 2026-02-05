/**
 * Configuration for stability-based mutation adaptation.
 *
 * Issue #1307: Reduce brittleness: Adaptive mutation rate based on validation stability.
 *
 * This configuration controls how mutation rates and breeding selection
 * adapt based on creature stability metrics.
 */

/**
 * Configuration for stability-based adaptation behaviour.
 */
export interface StabilityAdaptationConfig {
  /**
   * Whether stability-based adaptation is enabled.
   * When disabled, mutation proceeds without stability consideration.
   * Default: false
   */
  enabled?: boolean;

  /**
   * Size of the rolling window for tracking mutation outcomes.
   * A larger window is more stable but slower to adapt.
   * Default: 20
   */
  stabilityWindowSize?: number;

  /**
   * Brittleness rate threshold (0-1).
   * When the fraction of brittle mutations exceeds this threshold,
   * adaptive adjustments are applied.
   * Default: 0.3 (30%)
   */
  brittlenessThreshold?: number;

  /**
   * Factor to reduce mutation rate when creature is brittle.
   * Value between 0 and 1 (e.g., 0.5 = reduce by 50%).
   * Default: 0.5
   */
  brittleReductionFactor?: number;

  /**
   * Factor to boost mutation rate when creature is very stable.
   * Value greater than 1 (e.g., 1.3 = boost by 30%).
   * Default: 1.3
   */
  stableBoostFactor?: number;

  /**
   * Stability rate threshold above which boost is applied (0-1).
   * Default: 0.85 (85% stable)
   */
  stableBoostThreshold?: number;

  /**
   * Weight given to stability in parent selection (0-1).
   * Higher values make stability more important relative to fitness.
   * Default: 0.2
   */
  selectionStabilityWeight?: number;

  /**
   * Whether to adaptively adjust selection stability weight based on
   * population brittleness. When enabled, stability weight increases
   * when the population is brittle-heavy.
   * Default: false
   */
  adaptiveSelectionWeight?: boolean;

  /**
   * Weight factor for topology mutations (ADD_NODE, ADD_CONN) for brittle creatures.
   * Lower values reduce the probability of topology mutations.
   * Default: 0.3 (70% reduction)
   */
  topologyMutationReductionForBrittle?: number;

  /**
   * Whether to track and adapt per mutation type.
   * When enabled, mutation types with poor stability get reduced weights.
   * Default: false
   */
  trackPerMutationType?: boolean;
}

/**
 * Required version of StabilityAdaptationConfig with all fields populated.
 */
export type RequiredStabilityAdaptationConfig = Required<
  StabilityAdaptationConfig
>;

/**
 * Default values for stability adaptation configuration.
 */
export const DEFAULT_STABILITY_ADAPTATION_CONFIG:
  RequiredStabilityAdaptationConfig = {
    enabled: false,
    stabilityWindowSize: 20,
    brittlenessThreshold: 0.3,
    brittleReductionFactor: 0.5,
    stableBoostFactor: 1.3,
    stableBoostThreshold: 0.85,
    selectionStabilityWeight: 0.2,
    adaptiveSelectionWeight: false,
    topologyMutationReductionForBrittle: 0.3,
    trackPerMutationType: false,
  };
