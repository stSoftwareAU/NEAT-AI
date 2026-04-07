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
}

/**
 * Required version of MCMCConfig with all fields populated.
 */
export type RequiredMCMCConfig = Required<MCMCConfig>;

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
};
