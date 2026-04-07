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
import { MCMCDiagnostics } from "@neat/MCMCDiagnostics.ts";
import { getLogger } from "@utils/Logger.ts";

export class MCMCState {
  private currentTemperature: number;
  private readonly config: RequiredMCMCConfig;

  /** Issue #2201: Diagnostics for acceptance rate tracking and adaptive tuning. */
  readonly diagnostics: MCMCDiagnostics;

  constructor(config: RequiredMCMCConfig) {
    this.config = config;
    this.currentTemperature = config.initialTemperature;
    this.diagnostics = new MCMCDiagnostics(config);
  }

  /**
   * Returns the current temperature for Metropolis-Hastings acceptance.
   */
  getTemperature(): number {
    return this.currentTemperature;
  }

  /**
   * Issue #2201: Sets the temperature directly, used by adaptive
   * temperature tuning or external callers.
   *
   * @param temperature - The new temperature value
   */
  setTemperature(temperature: number): void {
    this.currentTemperature = temperature;
  }

  /**
   * Cools the temperature by one generation step and applies adaptive tuning.
   *
   * Issue #2201: After exponential cooling, adaptive tuning adjusts the
   * temperature based on the smoothed acceptance rate. If acceptance is
   * too high the temperature decreases; if too low it increases.
   *
   * @param verbose - Whether to log the temperature change and MCMC statistics
   */
  cool(verbose?: boolean): void {
    const previous = this.currentTemperature;

    // Exponential cooling schedule
    this.currentTemperature = Math.max(
      this.config.minTemperature,
      this.currentTemperature * this.config.coolingRate,
    );

    // Issue #2201: Adaptive temperature tuning based on acceptance rate
    const stats = this.diagnostics.getGenerationStats();
    this.diagnostics.finaliseGeneration();
    this.currentTemperature = this.diagnostics.adaptTemperature(
      this.currentTemperature,
    );

    if (verbose) {
      const smoothedRate = this.diagnostics.getSmoothedAcceptanceRate();
      if (stats.proposedCount > 0) {
        getLogger().info(
          `[MCMC] Gen: temp=${this.currentTemperature.toFixed(4)}, ` +
            `acceptance=${(stats.acceptanceRate * 100).toFixed(1)}% ` +
            `(smoothed=${(smoothedRate * 100).toFixed(1)}%), ` +
            `proposed=${stats.proposedCount}, ` +
            `accepted=${stats.acceptedCount}, ` +
            `rejected=${stats.rejectedCount}`,
        );
      } else {
        getLogger().info(
          `[MCMC] Temperature: ${previous.toFixed(6)} → ${
            this.currentTemperature.toFixed(6)
          }`,
        );
      }
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
