/**
 * Configuration for adaptive population sizing.
 *
 * Issue #1863: Automatically adjust population size based on
 * diversity metrics and convergence progress.
 */

/**
 * Configuration for adaptive population sizing behaviour.
 */
export interface AdaptivePopulationConfig {
  /** Whether adaptive population sizing is enabled. Default: false. */
  enabled?: boolean;

  /**
   * Minimum population size as a fraction of the configured populationSize.
   * Default: 0.5 (50% of configured size).
   */
  minPopulationFraction?: number;

  /**
   * Maximum population size as a fraction of the configured populationSize.
   * Default: 2.0 (200% of configured size).
   */
  maxPopulationFraction?: number;

  /**
   * Diversity threshold below which population grows.
   * When species diversity falls below this value, population increases.
   * Range: 0..1. Default: 0.3.
   */
  lowDiversityThreshold?: number;

  /**
   * Diversity threshold above which population may shrink during stagnation.
   * Range: 0..1. Default: 0.8.
   */
  highDiversityThreshold?: number;

  /**
   * Population adjustment step size per generation.
   * The population changes by at most this fraction per generation.
   * Range: 0..1. Default: 0.1 (10% per generation).
   */
  adjustmentRate?: number;
}

/**
 * Required version with all fields populated.
 */
export type RequiredAdaptivePopulationConfig = Required<
  AdaptivePopulationConfig
>;

/**
 * Default values for adaptive population sizing.
 */
export const DEFAULT_ADAPTIVE_POPULATION_CONFIG:
  RequiredAdaptivePopulationConfig = {
    enabled: false,
    minPopulationFraction: 0.5,
    maxPopulationFraction: 2.0,
    lowDiversityThreshold: 0.3,
    highDiversityThreshold: 0.8,
    adjustmentRate: 0.1,
  };
