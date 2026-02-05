/**
 * Adaptive mutation rate calculation based on validation stability.
 *
 * Issue #1307: Reduce brittleness: Adaptive mutation rate based on validation stability.
 *
 * This module provides adaptive mutation rate adjustment based on creature stability
 * metrics. It helps reduce brittleness by:
 * - Reducing mutation rates for brittle creatures
 * - Reducing topology mutation probability for brittle creatures
 * - Increasing weight/bias mutation preference when brittleness is detected
 * - Per-mutation-type adaptation based on type-specific stability
 */

import type { MutationStabilityTracker } from "./MutationStabilityTracker.ts";

/**
 * Configuration for adaptive mutation rate behaviour.
 */
export interface AdaptiveMutationRateConfig {
  /**
   * Whether adaptive mutation rate is enabled.
   * When disabled, base rates are used without adjustment.
   * Default: false
   */
  enabled?: boolean;

  /**
   * Base mutation rate before adaptation.
   * Default: 0.3
   */
  baseRate?: number;

  /**
   * Minimum mutation rate (floor).
   * Default: 0.05
   */
  minRate?: number;

  /**
   * Maximum mutation rate (ceiling).
   * Default: 0.9
   */
  maxRate?: number;

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
   * Stability rate threshold above which boost is applied.
   * Default: 0.85 (85% stable)
   */
  stableBoostThreshold?: number;

  /**
   * Weight factor for topology mutations (ADD_NODE, ADD_CONN) for brittle creatures.
   * Lower values reduce the probability of topology mutations.
   * Default: 0.3 (70% reduction)
   */
  topologyMutationReductionForBrittle?: number;

  /**
   * Whether to use per-mutation-type adaptation.
   * When enabled, mutation types with poor stability get reduced weights.
   * Default: false
   */
  usePerTypeAdaptation?: boolean;
}

/**
 * Required version of AdaptiveMutationRateConfig with all fields populated.
 */
export type RequiredAdaptiveMutationRateConfig = Required<
  AdaptiveMutationRateConfig
>;

/**
 * Default values for adaptive mutation rate configuration.
 */
export const DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG:
  RequiredAdaptiveMutationRateConfig = {
    enabled: false,
    baseRate: 0.3,
    minRate: 0.05,
    maxRate: 0.9,
    brittleReductionFactor: 0.5,
    stableBoostFactor: 1.3,
    stableBoostThreshold: 0.85,
    topologyMutationReductionForBrittle: 0.3,
    usePerTypeAdaptation: false,
  };

/**
 * Calculates adaptive mutation rates based on creature stability metrics.
 *
 * This class adjusts mutation parameters to reduce brittleness:
 * - Brittle creatures get reduced mutation rates and magnitude
 * - Brittle creatures favour weight/bias mutations over topology changes
 * - Stable creatures can get slightly boosted exploration
 *
 * @example
 * ```ts
 * const adaptive = new AdaptiveMutationRate({
 *   enabled: true,
 *   baseRate: 0.3,
 *   brittleReductionFactor: 0.5,
 * });
 *
 * // During mutation
 * const tracker = creature.stabilityTracker;
 * const adjustedRate = adaptive.getAdjustedMutationRate(tracker);
 * const topologyWeight = adaptive.getTopologyMutationWeight(tracker);
 * ```
 */
export class AdaptiveMutationRate {
  private readonly config: RequiredAdaptiveMutationRateConfig;

  /**
   * Creates a new AdaptiveMutationRate with the given configuration.
   *
   * @param config - Configuration options (defaults are applied)
   */
  constructor(config: AdaptiveMutationRateConfig) {
    this.config = {
      ...DEFAULT_ADAPTIVE_MUTATION_RATE_CONFIG,
      ...config,
    };
  }

  /**
   * Gets the adjusted mutation rate based on stability metrics.
   *
   * @param tracker - The creature's stability tracker (or undefined)
   * @returns Adjusted mutation rate
   */
  getAdjustedMutationRate(
    tracker: MutationStabilityTracker | undefined,
  ): number {
    if (!this.config.enabled || !tracker) {
      return this.config.baseRate;
    }

    const metrics = tracker.getMetrics();

    if (metrics.totalMutations === 0) {
      return this.config.baseRate;
    }

    let rate = this.config.baseRate;

    // Check for brittleness
    if (tracker.isBrittle()) {
      // Scale reduction based on how brittle
      const brittlenessRate = metrics.brittlenessRate;
      // Map brittleness rate to reduction: higher brittleness = more reduction
      const reductionAmount = brittlenessRate *
        (1 - this.config.brittleReductionFactor);
      rate = rate * (1 - reductionAmount);
    } // Check for high stability
    else if (metrics.stabilityRate >= this.config.stableBoostThreshold) {
      // Scale boost based on how stable above threshold
      const stabilityRatio = (metrics.stabilityRate -
        this.config.stableBoostThreshold) /
        (1.0 - this.config.stableBoostThreshold);
      const boostAmount = stabilityRatio *
        (this.config.stableBoostFactor - 1.0);
      rate = rate * (1 + boostAmount);
    }

    // Apply min/max bounds
    rate = Math.max(this.config.minRate, rate);
    rate = Math.min(this.config.maxRate, rate);

    return rate;
  }

  /**
   * Gets the weight multiplier for topology mutations (ADD_NODE, ADD_CONN).
   *
   * Brittle creatures should have reduced probability of topology mutations,
   * as these are more likely to produce unstable offspring.
   *
   * @param tracker - The creature's stability tracker (or undefined)
   * @returns Weight multiplier (1.0 = normal, < 1.0 = reduced)
   */
  getTopologyMutationWeight(
    tracker: MutationStabilityTracker | undefined,
  ): number {
    if (!this.config.enabled || !tracker) {
      return 1.0;
    }

    const metrics = tracker.getMetrics();

    if (metrics.totalMutations === 0) {
      return 1.0;
    }

    if (tracker.isBrittle()) {
      // Scale reduction based on brittleness
      const brittlenessRate = metrics.brittlenessRate;
      // Map to weight: 0% brittle = 1.0, 100% brittle = topologyMutationReductionForBrittle
      return 1.0 -
        brittlenessRate *
          (1.0 - this.config.topologyMutationReductionForBrittle);
    }

    return 1.0;
  }

  /**
   * Gets the preference weight for weight/bias mutations.
   *
   * Brittle creatures should prefer weight/bias mutations over topology changes.
   *
   * @param tracker - The creature's stability tracker (or undefined)
   * @returns Preference weight (0.75 = default, higher = more preference)
   */
  getWeightBiasPreference(
    tracker: MutationStabilityTracker | undefined,
  ): number {
    const defaultPreference = 0.75;

    if (!this.config.enabled || !tracker) {
      return defaultPreference;
    }

    const metrics = tracker.getMetrics();

    if (metrics.totalMutations === 0) {
      return defaultPreference;
    }

    if (tracker.isBrittle()) {
      // Increase preference for weight/bias mutations based on brittleness
      // Max preference is 0.95 (always leave some chance for topology)
      const brittlenessRate = metrics.brittlenessRate;
      const maxPreference = 0.95;
      return defaultPreference +
        brittlenessRate * (maxPreference - defaultPreference);
    }

    return defaultPreference;
  }

  /**
   * Gets the mutation magnitude multiplier.
   *
   * Delegates to the tracker's getMutationMagnitudeMultiplier if available.
   *
   * @param tracker - The creature's stability tracker (or undefined)
   * @returns Magnitude multiplier
   */
  getMutationMagnitudeMultiplier(
    tracker: MutationStabilityTracker | undefined,
  ): number {
    if (!this.config.enabled || !tracker) {
      return 1.0;
    }

    return tracker.getMutationMagnitudeMultiplier();
  }

  /**
   * Gets the weight for a specific mutation type based on its stability.
   *
   * This is used when usePerTypeAdaptation is enabled to prefer mutation
   * types that have historically produced stable offspring.
   *
   * @param tracker - The creature's stability tracker (or undefined)
   * @param mutationType - The mutation type name (e.g., "MOD_WEIGHT", "ADD_NODE")
   * @returns Weight for this mutation type (higher = more likely to be selected)
   */
  getMutationTypeWeight(
    tracker: MutationStabilityTracker | undefined,
    mutationType: string,
  ): number {
    if (!this.config.enabled || !this.config.usePerTypeAdaptation || !tracker) {
      return 1.0;
    }

    const typeMetrics = tracker.getMetricsForType(mutationType);

    if (typeMetrics.totalMutations === 0) {
      return 1.0; // No data, use default weight
    }

    // Use stability rate as the weight
    // More stable mutation types get higher weights
    return typeMetrics.stabilityRate;
  }

  /**
   * Checks if adaptive mutation rate is enabled.
   *
   * @returns true if enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Gets the current configuration.
   *
   * @returns The configuration object
   */
  getConfig(): RequiredAdaptiveMutationRateConfig {
    return { ...this.config };
  }
}
