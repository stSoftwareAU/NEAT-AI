/**
 * Configuration for Markov Chain Monte Carlo (MCMC) acceptance criterion.
 *
 * Issue #2199: MCMC provides temperature-based acceptance for the
 * Metropolis-Hastings criterion. Instead of unconditionally accepting
 * all mutations, MCMC acceptance allows worse-fitness moves with a
 * probability that decreases as temperature cools, enabling the
 * population to escape local optima early and converge later.
 *
 * Acceptance probability:
 *   P(accept) = min(1, exp(-deltaFitness / temperature))
 *
 * Temperature follows an exponential cooling schedule:
 *   T(g) = max(minTemperature, initialTemperature * coolingRate^g)
 *
 * The target acceptance rate (0.234) is the theoretically optimal rate
 * for high-dimensional MCMC (Roberts et al. 1997).
 */

/**
 * Issue #2456: Diversity-aware MCMC temperature curriculum.
 *
 * Couples the cooling schedule to the live diversity signal so that
 * temperature rises (reheats) when species count collapses or the
 * population becomes overcrowded within species.
 */
export interface DiversityAwareMCMCConfig {
  /** Whether diversity-aware reheating is active (default: true). */
  enabled?: boolean;

  /**
   * Reheat is triggered if the current species count drops below this
   * threshold (default: 4).
   */
  minSpecies?: number;

  /**
   * Reheat is triggered if the mean within-species compatibility exceeds
   * this threshold — large values indicate the population has crowded
   * into a small region of genome space (default: 0.85).
   */
  crowdingThreshold?: number;

  /**
   * Multiplicative factor applied to the current temperature when reheat
   * triggers. The result is clamped to `initialTemperature` from above
   * (default: 1.5).
   */
  reheatFactor?: number;
}

/** Required version of DiversityAwareMCMCConfig with all fields populated. */
export type RequiredDiversityAwareMCMCConfig = Required<
  DiversityAwareMCMCConfig
>;

/** Default values for the diversity-aware MCMC reheat curriculum. */
export const DEFAULT_DIVERSITY_AWARE_MCMC_CONFIG:
  RequiredDiversityAwareMCMCConfig = {
    enabled: true,
    minSpecies: 4,
    crowdingThreshold: 0.85,
    reheatFactor: 1.5,
  };

/**
 * Configuration for MCMC acceptance behaviour.
 */
export interface MCMCConfig {
  /** Whether MCMC acceptance is active (default: false). */
  enabled?: boolean;

  /** Starting temperature for Metropolis-Hastings acceptance (default: 1.0). */
  initialTemperature?: number;

  /** Floor temperature to prevent acceptance probability reaching zero (default: 0.01). */
  minTemperature?: number;

  /** Multiplicative cooling factor applied per generation (default: 0.995). */
  coolingRate?: number;

  /** Optimal acceptance rate for high-dimensional MCMC (default: 0.234). */
  targetAcceptanceRate?: number;

  /**
   * Issue #2201: Rate at which temperature is adjusted toward the target
   * acceptance rate each generation. Small values provide stability (default: 0.02).
   */
  adjustmentRate?: number;

  /**
   * Issue #2201: Tolerance band around the target acceptance rate within
   * which no temperature adjustment occurs (default: 0.05).
   */
  toleranceRate?: number;

  /**
   * Issue #2456: Diversity-aware MCMC temperature curriculum.
   *
   * When enabled, the cooling step reheats temperature (multiplied by
   * `reheatFactor`, capped at `initialTemperature`) whenever the live
   * diversity signal collapses — species count below `minSpecies` or
   * mean within-species compatibility above `crowdingThreshold`.
   * Otherwise the standard exponential cooling applies.
   */
  diversityAwareMCMC?: DiversityAwareMCMCConfig;
}

/**
 * Required version of MCMCConfig with all fields populated. The nested
 * `diversityAwareMCMC` block is also fully populated.
 */
export type RequiredMCMCConfig =
  & Required<Omit<MCMCConfig, "diversityAwareMCMC">>
  & { diversityAwareMCMC: RequiredDiversityAwareMCMCConfig };

/**
 * Default values for MCMC configuration.
 */
export const DEFAULT_MCMC_CONFIG: RequiredMCMCConfig = {
  enabled: false,
  initialTemperature: 1.0,
  minTemperature: 0.01,
  coolingRate: 0.995,
  targetAcceptanceRate: 0.234,
  adjustmentRate: 0.02,
  toleranceRate: 0.05,
  diversityAwareMCMC: DEFAULT_DIVERSITY_AWARE_MCMC_CONFIG,
};
