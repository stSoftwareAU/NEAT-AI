/**
 * MCMCState.ts - Tracks Markov Chain Monte Carlo temperature state
 * across generations for Metropolis-Hastings acceptance.
 *
 * Issue #2200: The temperature follows an exponential cooling schedule:
 *   T(g) = max(minTemperature, initialTemperature * coolingRate^g)
 *
 * High temperature early on allows the population to escape local optima;
 * low temperature later forces convergence.
 */

import type { RequiredMCMCConfig } from "@config/MCMCConfig.ts";
import { getLogger } from "@utils/Logger.ts";

export class MCMCState {
  private currentTemperature: number;
  private readonly config: RequiredMCMCConfig;

  constructor(config: RequiredMCMCConfig) {
    this.config = config;
    this.currentTemperature = config.initialTemperature;
  }

  /**
   * Returns the current temperature for Metropolis-Hastings acceptance.
   */
  getTemperature(): number {
    return this.currentTemperature;
  }

  /**
   * Cools the temperature by one generation step.
   * T_next = max(minTemperature, T_current * coolingRate)
   *
   * @param verbose - Whether to log the temperature change
   */
  cool(verbose?: boolean): void {
    const previous = this.currentTemperature;
    this.currentTemperature = Math.max(
      this.config.minTemperature,
      this.currentTemperature * this.config.coolingRate,
    );

    if (verbose) {
      getLogger().info(
        `[MCMC] Temperature cooled: ${previous.toFixed(6)} → ${
          this.currentTemperature.toFixed(6)
        }`,
      );
    }
  }

  /**
   * Resets temperature to the initial value.
   * Useful for restarts or testing.
   */
  reset(): void {
    this.currentTemperature = this.config.initialTemperature;
  }
}
