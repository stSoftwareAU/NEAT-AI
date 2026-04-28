/**
 * MCMCState.ts - Tracks Markov Chain Monte Carlo temperature state
 * across generations for Metropolis-Hastings acceptance.
 *
 * Issue #2200: The temperature follows an exponential cooling schedule:
 *   T(g) = max(minTemperature, initialTemperature * coolingRate^g)
 *
 * High temperature early on allows the population to escape local optima;
 * low temperature later forces convergence.
 *
 * Issue #2456: When `diversityAwareMCMC.enabled` is true, the cooling step
 * accepts an optional diversity snapshot (species count and mean
 * within-species compatibility). If diversity has collapsed — species
 * count below `minSpecies` or mean within-species compatibility above
 * `crowdingThreshold` — temperature is multiplied by `reheatFactor`
 * instead of cooling, capped at `initialTemperature`. Otherwise the
 * standard exponential schedule applies.
 */

import type { RequiredMCMCConfig } from "@config/MCMCConfig.ts";
import { MCMCDiagnostics } from "@neat/MCMCDiagnostics.ts";
import { getLogger } from "@utils/Logger.ts";

/**
 * Issue #2456: Live diversity signal passed into the cooling step.
 *
 * Both fields are optional so callers can supply only what they have.
 * When a field is missing, its branch of the reheat trigger is skipped.
 */
export interface DiversitySnapshot {
  /** Number of distinct species in the current population. */
  speciesCount?: number;
  /**
   * Mean within-species compatibility (higher = more crowded). The
   * exact metric is up to the caller; values are compared against
   * `diversityAwareMCMC.crowdingThreshold` from the config.
   */
  meanWithinSpeciesCompatibility?: number;
}

export class MCMCState {
  private currentTemperature: number;
  private readonly config: RequiredMCMCConfig;

  /** Issue #2201: Diagnostics for acceptance rate tracking and adaptive tuning. */
  readonly diagnostics: MCMCDiagnostics;

  /** Issue #2456: Last diversity snapshot fed into cool(), for diagnostics/tests. */
  private lastDiversity: DiversitySnapshot | undefined;
  /** Issue #2456: True if the most recent cool() reheated rather than cooled. */
  private lastReheated = false;

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
   * Issue #2456: When `diversityAwareMCMC.enabled` is true and a diversity
   * snapshot is provided, the schedule reheats (multiplies temperature
   * by `reheatFactor`, clamped to `initialTemperature`) whenever species
   * count is below `minSpecies` or mean within-species compatibility is
   * above `crowdingThreshold`. Otherwise the standard exponential cooling
   * applies. When the flag is disabled, the diversity argument has no
   * effect — exact regression with the pre-#2456 schedule.
   *
   * @param verbose - Whether to log the temperature change and MCMC statistics
   * @param diversity - Optional live diversity snapshot from the evolution loop
   */
  cool(verbose?: boolean, diversity?: DiversitySnapshot): void {
    const previous = this.currentTemperature;
    this.lastDiversity = diversity;

    // Issue #2456: Reheat when diversity has collapsed.
    const diversityCfg = this.config.diversityAwareMCMC;
    const reheat = diversityCfg.enabled && diversity !== undefined &&
      this.shouldReheat(diversity);
    this.lastReheated = reheat;

    if (reheat) {
      // Multiply by reheatFactor, but never exceed initialTemperature.
      this.currentTemperature = Math.min(
        this.config.initialTemperature,
        this.currentTemperature * diversityCfg.reheatFactor,
      );
    } else {
      // Standard exponential cooling schedule.
      this.currentTemperature = Math.max(
        this.config.minTemperature,
        this.currentTemperature * this.config.coolingRate,
      );
    }

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
    this.lastDiversity = undefined;
    this.lastReheated = false;
  }

  /**
   * Issue #2456: Returns true when the most recent {@link cool} call
   * reheated the temperature in response to a diversity collapse rather
   * than applying the exponential cooling schedule.
   */
  didReheatLastGeneration(): boolean {
    return this.lastReheated;
  }

  /**
   * Issue #2456: Returns the diversity snapshot fed into the most recent
   * {@link cool} call, or `undefined` if none was provided.
   */
  getLastDiversitySnapshot(): DiversitySnapshot | undefined {
    return this.lastDiversity;
  }

  /**
   * Issue #2456: Decides whether the supplied diversity snapshot crosses
   * either reheat trigger. Either branch independently triggers reheat;
   * unset fields skip their respective branch.
   */
  private shouldReheat(snapshot: DiversitySnapshot): boolean {
    const cfg = this.config.diversityAwareMCMC;
    if (
      snapshot.speciesCount !== undefined &&
      snapshot.speciesCount < cfg.minSpecies
    ) {
      return true;
    }
    if (
      snapshot.meanWithinSpeciesCompatibility !== undefined &&
      snapshot.meanWithinSpeciesCompatibility > cfg.crowdingThreshold
    ) {
      return true;
    }
    return false;
  }
}
