/**
 * Fitness plateau detection and stagnation response.
 *
 * Issue #1039: Performance: Implement fitness plateau detection with stagnation response
 *
 * This module provides mechanisms to detect when evolution has stagnated
 * (fitness improvement falls below a threshold) and suggests responses
 * to help escape local optima.
 */

/**
 * Configuration for plateau detection behaviour.
 *
 * Issue #1039: Plateau detection with stagnation response.
 * Issue #1012: Adaptive mutation rate based on fitness progress.
 */
export interface PlateauDetectionConfig {
  /**
   * Number of generations to consider when calculating improvement rate.
   * A larger window is more stable but slower to detect plateaus.
   * Default: 10
   */
  windowSize?: number;

  /**
   * Minimum improvement rate (as a fraction) required to not be considered a plateau.
   * For example, 0.001 means 0.1% improvement over the window is required.
   * Default: 0.001 (0.1%)
   */
  minImprovementRate?: number;

  /**
   * Threshold improvement rate (as a fraction) above which evolution is considered
   * to be "rapidly improving". When improvement rate exceeds this threshold,
   * the mutation rate is reduced to exploit good solutions.
   * Must be greater than minImprovementRate.
   * Default: 0.01 (1%)
   *
   * Issue #1012: Adaptive mutation rate based on fitness progress.
   */
  rapidImprovementRate?: number;

  /**
   * Multiplier to apply to mutation rate when on a plateau.
   * Higher values cause more aggressive mutations to escape local optima.
   * Default: 2.0
   */
  responseMutationMultiplier?: number;

  /**
   * Multiplier to apply to mutation rate when rapidly improving.
   * Lower values reduce mutations to exploit good solutions.
   * Must be between 0 and 1.
   * Default: 0.8 (20% reduction)
   *
   * Issue #1012: Adaptive mutation rate based on fitness progress.
   */
  responseImprovementMultiplier?: number;

  /**
   * Whether plateau detection is enabled.
   * When disabled, plateau detection has no effect.
   * Default: false
   */
  enabled?: boolean;
}

/**
 * Required version of PlateauDetectionConfig with all fields populated.
 * Used internally after defaults are applied.
 */
export type RequiredPlateauDetectionConfig = Required<PlateauDetectionConfig>;

/**
 * Default values for plateau detection configuration.
 *
 * Issue #1039: Plateau detection with stagnation response.
 * Issue #1012: Adaptive mutation rate based on fitness progress.
 */
export const DEFAULT_PLATEAU_DETECTION: RequiredPlateauDetectionConfig = {
  windowSize: 10,
  minImprovementRate: 0.001, // 0.1% improvement required
  rapidImprovementRate: 0.01, // 1% improvement threshold for "rapid" improvement
  responseMutationMultiplier: 2.0,
  responseImprovementMultiplier: 0.8, // 20% reduction during rapid improvement
  enabled: false, // Off by default to maintain backwards compatibility
};

/**
 * Detects fitness plateaus and provides stagnation response recommendations.
 *
 * A plateau is detected when the fitness improvement rate over the configured
 * window falls below the minimum improvement threshold.
 *
 * @example
 * ```ts
 * const detector = new PlateauDetector({
 *   windowSize: 10,
 *   minImprovementRate: 0.001,
 *   responseMutationMultiplier: 2.0,
 *   enabled: true,
 * });
 *
 * // During evolution loop:
 * detector.recordFitness(fittestCreature.score);
 *
 * if (detector.isOnPlateau()) {
 *   const multiplier = detector.getMutationMultiplier();
 *   // Apply increased mutation rate
 * }
 * ```
 */
export class PlateauDetector {
  private readonly config: RequiredPlateauDetectionConfig;
  private fitnessHistory: number[] = [];
  private generationsOnPlateau = 0;
  private lastPlateauState = false;

  /**
   * Creates a new PlateauDetector with the given configuration.
   *
   * @param config - Plateau detection configuration (all fields required)
   */
  constructor(config: RequiredPlateauDetectionConfig) {
    this.config = config;
  }

  /**
   * Records a fitness value for the current generation.
   *
   * @param fitness - The fitness score to record (typically the fittest creature's score)
   */
  recordFitness(fitness: number): void {
    this.fitnessHistory.push(fitness);

    // Keep only the values needed for the window
    const maxHistory = this.config.windowSize + 1;
    if (this.fitnessHistory.length > maxHistory) {
      this.fitnessHistory = this.fitnessHistory.slice(-maxHistory);
    }

    // Update plateau tracking
    const isCurrentlyOnPlateau = this.checkPlateau();
    if (isCurrentlyOnPlateau) {
      if (this.lastPlateauState) {
        this.generationsOnPlateau++;
      } else {
        // Just entered plateau
        this.generationsOnPlateau = 1;
      }
    } else {
      this.generationsOnPlateau = 0;
    }
    this.lastPlateauState = isCurrentlyOnPlateau;
  }

  /**
   * Checks if evolution is currently on a fitness plateau.
   *
   * @returns true if on a plateau, false otherwise
   */
  isOnPlateau(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    return this.checkPlateau();
  }

  /**
   * Checks if evolution is currently improving rapidly.
   *
   * Rapid improvement is detected when the improvement rate exceeds
   * the configured rapidImprovementRate threshold.
   *
   * Issue #1012: Adaptive mutation rate based on fitness progress.
   *
   * @returns true if rapidly improving, false otherwise
   */
  isImproving(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    return this.checkImproving();
  }

  /**
   * Internal method to check rapid improvement status.
   *
   * Issue #1012: Adaptive mutation rate based on fitness progress.
   */
  private checkImproving(): boolean {
    if (this.fitnessHistory.length < this.config.windowSize) {
      return false;
    }

    const rate = this.calculateImprovementRate();
    if (rate === null) {
      return false;
    }

    return rate >= this.config.rapidImprovementRate;
  }

  /**
   * Internal method to check plateau status.
   */
  private checkPlateau(): boolean {
    if (this.fitnessHistory.length < this.config.windowSize) {
      return false;
    }

    const rate = this.calculateImprovementRate();
    if (rate === null) {
      return false;
    }

    return rate < this.config.minImprovementRate;
  }

  /**
   * Gets the current improvement rate over the window.
   *
   * @returns The improvement rate as a fraction, or null if insufficient history
   */
  getImprovementRate(): number | null {
    if (this.fitnessHistory.length < this.config.windowSize) {
      return null;
    }
    return this.calculateImprovementRate();
  }

  /**
   * Calculates the improvement rate over the configured window.
   */
  private calculateImprovementRate(): number | null {
    if (this.fitnessHistory.length < this.config.windowSize) {
      return null;
    }

    const historyLength = this.fitnessHistory.length;
    const windowStart = historyLength - this.config.windowSize;
    const oldestInWindow = this.fitnessHistory[windowStart];
    const newest = this.fitnessHistory[historyLength - 1];

    // Calculate improvement (higher fitness is better)
    const improvement = newest - oldestInWindow;

    // Calculate rate relative to the absolute value of the starting point
    // Handle edge case where oldestInWindow is 0 or very close to 0
    const baseline = Math.abs(oldestInWindow);
    if (baseline < 1e-10) {
      // If baseline is essentially zero, use absolute improvement
      return improvement;
    }

    return improvement / baseline;
  }

  /**
   * Gets the mutation multiplier to apply based on fitness progress status.
   *
   * Returns:
   * - responseMutationMultiplier (> 1) if on a plateau (stagnation)
   * - responseImprovementMultiplier (< 1) if rapidly improving
   * - 1.0 for stable progress (between plateau and rapid improvement)
   *
   * Issue #1012: Adaptive mutation rate based on fitness progress.
   *
   * @returns The appropriate multiplier based on current evolution state
   */
  getMutationMultiplier(): number {
    if (this.isOnPlateau()) {
      return this.config.responseMutationMultiplier;
    }
    if (this.isImproving()) {
      return this.config.responseImprovementMultiplier;
    }
    return 1.0;
  }

  /**
   * Gets the number of generations evolution has been on a plateau.
   *
   * @returns The number of consecutive generations on a plateau
   */
  getGenerationsOnPlateau(): number {
    return this.generationsOnPlateau;
  }

  /**
   * Resets the detector, clearing all history.
   *
   * Call this when starting a new evolution run or when major changes
   * are made to the population.
   */
  reset(): void {
    this.fitnessHistory = [];
    this.generationsOnPlateau = 0;
    this.lastPlateauState = false;
  }
}

/**
 * Utility function to detect plateau from a fitness history array.
 *
 * This is a stateless convenience function for one-off checks.
 * For continuous monitoring during evolution, use the PlateauDetector class.
 *
 * @param history - Array of fitness values (oldest first)
 * @param windowSize - Number of recent values to consider
 * @param minImprovementRate - Minimum improvement rate threshold
 * @returns Object with onPlateau status and calculated improvement rate
 */
export function detectPlateau(
  history: number[],
  windowSize: number,
  minImprovementRate: number,
): { onPlateau: boolean; improvementRate: number } {
  if (history.length < windowSize) {
    return { onPlateau: false, improvementRate: 0 };
  }

  const windowStart = history.length - windowSize;
  const oldestInWindow = history[windowStart];
  const newest = history[history.length - 1];

  const improvement = newest - oldestInWindow;
  const baseline = Math.abs(oldestInWindow);

  let improvementRate: number;
  if (baseline < 1e-10) {
    improvementRate = improvement;
  } else {
    improvementRate = improvement / baseline;
  }

  return {
    onPlateau: improvementRate < minImprovementRate,
    improvementRate: improvementRate,
  };
}
