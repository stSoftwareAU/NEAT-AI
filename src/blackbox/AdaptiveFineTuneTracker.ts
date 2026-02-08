import type { RequiredFineTunePopulationConfig } from "../config/FineTunePopulationConfig.ts";

/**
 * Tracks the success rate of fine-tuning across generations and calculates
 * an adaptive population size based on recent improvement history.
 *
 * Issue #1323: Instead of a fixed 20% fine-tuning population, this tracker
 * dynamically adjusts the size based on whether fine-tuning has been
 * producing improvements in recent generations.
 */
export class AdaptiveFineTuneTracker {
  private readonly config: RequiredFineTunePopulationConfig;
  private readonly outcomes: boolean[] = [];

  constructor(config: RequiredFineTunePopulationConfig) {
    this.config = config;
  }

  /**
   * Record the outcome of a generation's fine-tuning.
   *
   * @param improved - Whether any fine-tuned creature became the new fittest
   *   (i.e., the fittest creature in the new generation originated from
   *   fine-tuning)
   */
  recordOutcome(improved: boolean): void {
    this.outcomes.push(improved);
    if (this.outcomes.length > this.config.successRateWindow) {
      this.outcomes.shift();
    }
  }

  /**
   * Calculate the current success rate based on the rolling window.
   *
   * @returns A number between 0 and 1 representing the fraction of recent
   *   generations where fine-tuning produced an improvement. Returns NaN
   *   when no outcomes have been recorded yet.
   */
  getSuccessRate(): number {
    if (this.outcomes.length === 0) return NaN;
    const successes = this.outcomes.filter((o) => o).length;
    return successes / this.outcomes.length;
  }

  /**
   * Calculate the adaptive fine-tune population size.
   *
   * The size is interpolated between min and max based on the success rate:
   * - No data yet: uses the base population fraction
   * - 0% success: uses min population fraction
   * - 100% success: uses max population fraction
   *
   * The result is also bounded below by the number of "dead slots" available
   * (matching the original heuristic's second term).
   *
   * @param populationSize - The configured total population size
   * @param currentPopulationLength - Current number of living creatures
   * @param elitism - Number of elite creatures retained
   * @param trainingCompleteLength - Number of creatures that completed training
   * @returns The fine-tune population size to use
   */
  calculatePopSize(
    populationSize: number,
    currentPopulationLength: number,
    elitism: number,
    trainingCompleteLength: number,
  ): number {
    const successRate = this.getSuccessRate();

    let fraction: number;
    if (Number.isNaN(successRate)) {
      // No data yet - use the base fraction (matches original 20% heuristic)
      fraction = this.config.basePopulationFraction;
    } else {
      // Linearly interpolate between min and max based on success rate
      fraction = this.config.minPopulationFraction +
        successRate *
          (this.config.maxPopulationFraction -
            this.config.minPopulationFraction);
    }

    const adaptiveSize = Math.ceil(populationSize * fraction);

    // Also consider dead slots (original heuristic's second term)
    const deadSlots = populationSize - currentPopulationLength -
      elitism - trainingCompleteLength;

    return Math.max(adaptiveSize, deadSlots);
  }

  /**
   * Returns the number of recorded outcomes.
   */
  getOutcomeCount(): number {
    return this.outcomes.length;
  }
}
