/**
 * MCMCDiagnostics.ts - MCMC acceptance rate tracking and adaptive temperature tuning.
 *
 * Issue #2201: Tracks per-generation acceptance statistics (proposed, accepted,
 * rejected) and provides a rolling-window smoothed acceptance rate. Implements
 * adaptive temperature tuning that adjusts temperature toward the target
 * acceptance rate (Roberts et al. 1997: ~23.4% for high-dimensional MCMC).
 *
 * - Acceptance rate too high → decrease temperature (be more selective)
 * - Acceptance rate too low → increase temperature (accept more)
 *
 * Complements PlateauDetector: plateau detection adjusts *how much* mutation
 * happens, while MCMC temperature adjusts *which mutations stick*.
 */

import type { RequiredMCMCConfig } from "@config/MCMCConfig.ts";

/**
 * Per-generation MCMC statistics.
 */
export interface MCMCGenerationStats {
  /** Total mutations proposed this generation. */
  proposedCount: number;
  /** Mutations accepted this generation. */
  acceptedCount: number;
  /** Mutations rejected this generation. */
  rejectedCount: number;
  /** Acceptance rate for this generation (accepted / proposed, or 0). */
  acceptanceRate: number;
}

/**
 * Adjustment rate for adaptive temperature tuning.
 * Small value for stability (Issue #2201).
 */
const ADJUSTMENT_RATE = 0.02;

/**
 * Tolerance band around the target acceptance rate.
 * No adjustment is made when the smoothed rate is within
 * targetAcceptanceRate ± TOLERANCE.
 */
const TOLERANCE = 0.05;

/**
 * Default rolling window size (number of generations).
 */
const DEFAULT_WINDOW_SIZE = 10;

export class MCMCDiagnostics {
  private readonly config: RequiredMCMCConfig;
  private readonly windowSize: number;

  /** Current generation counters. */
  private currentAccepted = 0;
  private currentRejected = 0;

  /** Rolling window of per-generation acceptance rates. */
  private readonly rateHistory: number[] = [];

  constructor(config: RequiredMCMCConfig, windowSize = DEFAULT_WINDOW_SIZE) {
    this.config = config;
    this.windowSize = windowSize;
  }

  /**
   * Records an acceptance/rejection decision from Metropolis-Hastings.
   * No-op when MCMC is disabled.
   */
  recordDecision(accepted: boolean): void {
    if (!this.config.enabled) return;

    if (accepted) {
      this.currentAccepted++;
    } else {
      this.currentRejected++;
    }
  }

  /**
   * Returns the acceptance rate for the current (in-progress) generation.
   * Returns 0 when no decisions have been recorded.
   */
  getAcceptanceRate(): number {
    const total = this.currentAccepted + this.currentRejected;
    if (total === 0) return 0;
    return this.currentAccepted / total;
  }

  /**
   * Returns per-generation statistics for the current (in-progress) generation.
   */
  getGenerationStats(): MCMCGenerationStats {
    const proposed = this.currentAccepted + this.currentRejected;
    return {
      proposedCount: proposed,
      acceptedCount: this.currentAccepted,
      rejectedCount: this.currentRejected,
      acceptanceRate: proposed > 0 ? this.currentAccepted / proposed : 0,
    };
  }

  /**
   * Returns the smoothed acceptance rate over the rolling window.
   * Returns 0 when no generations have been finalised.
   */
  getSmoothedAcceptanceRate(): number {
    if (this.rateHistory.length === 0) return 0;

    let sum = 0;
    for (const rate of this.rateHistory) {
      sum += rate;
    }
    return sum / this.rateHistory.length;
  }

  /**
   * Finalises the current generation: pushes its acceptance rate into
   * the rolling window and resets per-generation counters.
   * No-op when MCMC is disabled.
   */
  finaliseGeneration(): void {
    if (!this.config.enabled) return;

    const rate = this.getAcceptanceRate();
    this.rateHistory.push(rate);

    // Trim to window size
    while (this.rateHistory.length > this.windowSize) {
      this.rateHistory.shift();
    }

    // Reset current generation counters
    this.currentAccepted = 0;
    this.currentRejected = 0;
  }

  /**
   * Adjusts the temperature based on the smoothed acceptance rate.
   *
   * - If smoothed rate > target + tolerance: decrease temperature (more selective)
   * - If smoothed rate < target - tolerance: increase temperature (accept more)
   * - Otherwise: no adjustment
   *
   * Temperature is clamped between minTemperature and initialTemperature.
   * Returns the temperature unchanged when MCMC is disabled or when
   * no generations have been finalised.
   *
   * @param currentTemperature - The current MCMC temperature
   * @returns The adjusted temperature
   */
  adaptTemperature(currentTemperature: number): number {
    if (!this.config.enabled) return currentTemperature;
    if (this.rateHistory.length === 0) return currentTemperature;

    const smoothedRate = this.getSmoothedAcceptanceRate();
    const target = this.config.targetAcceptanceRate;
    let adjusted = currentTemperature;

    if (smoothedRate > target + TOLERANCE) {
      // Acceptance too high → decrease temperature (be more selective)
      adjusted = currentTemperature * (1 - ADJUSTMENT_RATE);
    } else if (smoothedRate < target - TOLERANCE) {
      // Acceptance too low → increase temperature (accept more)
      adjusted = currentTemperature * (1 + ADJUSTMENT_RATE);
    }

    // Clamp between bounds
    return Math.max(
      this.config.minTemperature,
      Math.min(this.config.initialTemperature, adjusted),
    );
  }
}
