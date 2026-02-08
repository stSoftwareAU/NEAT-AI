/**
 * Configuration for adaptive fine-tuning population sizing.
 *
 * Issue #1323: The fine-tuning population size was calculated using a fixed
 * heuristic (20% of population or number of dead creatures). This configuration
 * enables dynamic adjustment based on how successful fine-tuning has been in
 * recent generations.
 *
 * When fine-tuning is producing improvements, the population size increases
 * to allocate more resources to a productive strategy. When fine-tuning
 * consistently fails, the size decreases to reduce wasted computation.
 */

/**
 * Configuration for adaptive fine-tuning population sizing behaviour.
 */
export interface FineTunePopulationConfig {
  /**
   * Minimum fraction of the population allocated to fine-tuning.
   * The fine-tune population size will never drop below
   * `ceil(populationSize * minPopulationFraction)`.
   * Default: 0.1 (10%)
   */
  minPopulationFraction?: number;

  /**
   * Maximum fraction of the population allocated to fine-tuning.
   * The fine-tune population size will never exceed
   * `ceil(populationSize * maxPopulationFraction)`.
   * Default: 0.4 (40%)
   */
  maxPopulationFraction?: number;

  /**
   * Base fraction of the population allocated to fine-tuning when no
   * success data is available yet.
   * Default: 0.2 (20%, matching the original fixed heuristic)
   */
  basePopulationFraction?: number;

  /**
   * Number of recent generations to consider when calculating the
   * fine-tuning success rate.
   * Default: 10
   */
  successRateWindow?: number;
}

/**
 * Required version of FineTunePopulationConfig with all fields populated.
 */
export type RequiredFineTunePopulationConfig = Required<
  FineTunePopulationConfig
>;

/**
 * Default values for fine-tune population configuration.
 */
export const DEFAULT_FINE_TUNE_POPULATION_CONFIG:
  RequiredFineTunePopulationConfig = {
    minPopulationFraction: 0.1,
    maxPopulationFraction: 0.4,
    basePopulationFraction: 0.2,
    successRateWindow: 10,
  };
