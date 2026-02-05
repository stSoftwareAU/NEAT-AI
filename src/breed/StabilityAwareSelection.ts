/**
 * Stability-aware parent selection for breeding.
 *
 * Issue #1307: Reduce brittleness: Adaptive mutation rate based on validation stability.
 *
 * This module provides stability-aware parent selection that factors in
 * mutation stability when selecting parents for breeding. Creatures that
 * consistently produce stable offspring are preferred over those producing
 * brittle offspring.
 */

import type { MutationStabilityTracker } from "../NEAT/MutationStabilityTracker.ts";

/**
 * Configuration for stability-aware selection behaviour.
 */
export interface StabilitySelectionConfig {
  /**
   * Whether stability-aware selection is enabled.
   * When disabled, selection proceeds without stability consideration.
   * Default: false
   */
  enabled?: boolean;

  /**
   * Weight given to stability in selection (0-1).
   * Higher values make stability more important relative to fitness.
   * Final fitness = baseFitness * (1 - stabilityWeight) + stabilityScore * stabilityWeight
   * Default: 0.2
   */
  stabilityWeight?: number;

  /**
   * Whether to adaptively adjust stability weight based on population brittleness.
   * When enabled, stability weight increases when the population is brittle-heavy.
   * Default: false
   */
  adaptiveWeightAdjustment?: boolean;

  /**
   * Threshold for population brittleness to trigger adaptive adjustment (0-1).
   * When the fraction of brittle creatures exceeds this threshold,
   * stability weight starts increasing.
   * Default: 0.3
   */
  brittlePopulationThreshold?: number;

  /**
   * Maximum stability weight when adaptively adjusting (0-1).
   * Prevents stability from dominating selection entirely.
   * Default: 0.5
   */
  maxStabilityWeight?: number;
}

/**
 * Required version of StabilitySelectionConfig with all fields populated.
 */
export type RequiredStabilitySelectionConfig = Required<
  StabilitySelectionConfig
>;

/**
 * Default values for stability selection configuration.
 */
export const DEFAULT_STABILITY_SELECTION_CONFIG:
  RequiredStabilitySelectionConfig = {
    enabled: false,
    stabilityWeight: 0.2,
    adaptiveWeightAdjustment: false,
    brittlePopulationThreshold: 0.3,
    maxStabilityWeight: 0.5,
  };

/**
 * Stability ranking entry for a tracker.
 */
export interface StabilityRankingEntry {
  tracker: MutationStabilityTracker;
  stabilityScore: number;
  rank: number;
}

/**
 * Provides stability-aware parent selection for breeding.
 *
 * This class adjusts selection probabilities based on creature stability:
 * - Stable creatures get higher selection weights
 * - Brittle creatures get lower selection weights
 * - When the population is brittle-heavy, stability becomes more important
 *
 * @example
 * ```ts
 * const selection = new StabilityAwareSelection({
 *   enabled: true,
 *   stabilityWeight: 0.2,
 * });
 *
 * // During parent selection
 * const adjustedFitness = selection.getAdjustedFitness(
 *   creature.score,
 *   creature.stabilityTracker,
 * );
 * ```
 */
export class StabilityAwareSelection {
  private readonly config: RequiredStabilitySelectionConfig;

  /**
   * Creates a new StabilityAwareSelection with the given configuration.
   *
   * @param config - Configuration options (defaults are applied)
   */
  constructor(config: StabilitySelectionConfig) {
    this.config = {
      ...DEFAULT_STABILITY_SELECTION_CONFIG,
      ...config,
    };
  }

  /**
   * Gets the selection weight multiplier based on stability.
   *
   * Higher values indicate the creature should have higher selection probability.
   *
   * @param tracker - The creature's stability tracker (or undefined)
   * @returns Selection weight multiplier (1.0 = neutral)
   */
  getSelectionWeight(
    tracker: MutationStabilityTracker | undefined,
  ): number {
    if (!this.config.enabled || !tracker) {
      return 1.0;
    }

    const stabilityScore = tracker.getStabilityScore();
    // Map stability score (0-1) to weight multiplier (0.5-1.5)
    // Low stability = 0.5x weight, High stability = 1.5x weight
    return 0.5 + stabilityScore;
  }

  /**
   * Gets the adjusted fitness score based on stability.
   *
   * Combines base fitness with stability score using the configured weight.
   *
   * @param baseFitness - The creature's base fitness score
   * @param tracker - The creature's stability tracker (or undefined)
   * @returns Adjusted fitness score
   */
  getAdjustedFitness(
    baseFitness: number,
    tracker: MutationStabilityTracker | undefined,
  ): number {
    if (!this.config.enabled || !tracker) {
      return baseFitness;
    }

    const metrics = tracker.getMetrics();
    if (metrics.totalMutations === 0) {
      return baseFitness;
    }

    const stabilityScore = tracker.getStabilityScore();
    const weight = this.config.stabilityWeight;

    // Blend base fitness with stability score
    // When weight = 0.2: 80% base fitness + 20% stability
    return baseFitness * (1 - weight) + stabilityScore * weight * baseFitness;
  }

  /**
   * Calculates the population brittleness level.
   *
   * Returns the fraction of creatures in the population that are considered brittle.
   *
   * @param trackers - Array of stability trackers for the population
   * @returns Fraction of brittle creatures (0-1)
   */
  getPopulationBrittlenessLevel(
    trackers: MutationStabilityTracker[],
  ): number {
    if (trackers.length === 0) {
      return 0;
    }

    let brittleCount = 0;
    for (const tracker of trackers) {
      if (tracker.isBrittle()) {
        brittleCount++;
      }
    }

    return brittleCount / trackers.length;
  }

  /**
   * Gets the adaptive stability weight based on population brittleness.
   *
   * When the population is brittle-heavy, stability weight is increased
   * to favour stable parents and reduce brittleness in the next generation.
   *
   * @param trackers - Array of stability trackers for the population
   * @returns Adjusted stability weight
   */
  getAdaptiveStabilityWeight(
    trackers: MutationStabilityTracker[],
  ): number {
    if (!this.config.adaptiveWeightAdjustment) {
      return this.config.stabilityWeight;
    }

    const brittleness = this.getPopulationBrittlenessLevel(trackers);

    // Below threshold: use base weight
    if (brittleness <= this.config.brittlePopulationThreshold) {
      return this.config.stabilityWeight;
    }

    // Above threshold: scale up weight based on brittleness
    const excessBrittleness = brittleness -
      this.config.brittlePopulationThreshold;
    const maxExcess = 1.0 - this.config.brittlePopulationThreshold;
    const brittlenessRatio = excessBrittleness / maxExcess;

    // Interpolate from base weight to max weight
    const additionalWeight =
      (this.config.maxStabilityWeight - this.config.stabilityWeight) *
      brittlenessRatio;

    return this.config.stabilityWeight + additionalWeight;
  }

  /**
   * Gets a stability ranking of trackers.
   *
   * Returns trackers sorted by stability score (most stable first).
   *
   * @param trackers - Array of stability trackers to rank
   * @returns Ranked array of stability entries
   */
  getStabilityRanking(
    trackers: MutationStabilityTracker[],
  ): StabilityRankingEntry[] {
    const entries: StabilityRankingEntry[] = trackers.map((tracker) => ({
      tracker,
      stabilityScore: tracker.getStabilityScore(),
      rank: 0, // Will be set after sorting
    }));

    // Sort by stability score (highest first)
    entries.sort((a, b) => b.stabilityScore - a.stabilityScore);

    // Assign ranks
    for (let i = 0; i < entries.length; i++) {
      entries[i].rank = i + 1;
    }

    return entries;
  }

  /**
   * Checks if stability-aware selection is enabled.
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
  getConfig(): RequiredStabilitySelectionConfig {
    return { ...this.config };
  }
}
