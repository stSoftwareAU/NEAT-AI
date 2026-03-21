/**
 * Adaptive scaling for Predictive Coding parameters on complex creatures.
 *
 * Issue #1915: Default PC configuration values (inferenceRate, energyThreshold,
 * learningRate) are tuned for small networks (~5 neurons). On complex creatures
 * with 30-90+ neurons, these defaults produce no measurable improvement because:
 *
 * 1. The energy threshold is per-network, not per-neuron. With N error terms,
 *    even small per-neuron errors sum to energy well above 1e-6, so inference
 *    exhausts all steps without converging.
 * 2. The inference rate doesn't account for gradient magnitude scaling with
 *    network connectivity, causing oscillation or negligible updates.
 * 3. The learning rate produces imperceptible weight changes when spread across
 *    many parameters.
 *
 * This module computes effective PC parameters scaled by network topology,
 * preserving default behaviour for small networks (≤10 hidden neurons).
 */

import type { Creature } from "../Creature.ts";
import type { RequiredPredictiveCodingConfig } from "../config/PredictiveCodingConfig.ts";

/**
 * Threshold below which no adaptive scaling is applied.
 * Networks with this many or fewer hidden neurons use config values as-is.
 */
const SCALING_THRESHOLD = 10;

/**
 * Effective PC parameters after adaptive scaling for network topology.
 */
export interface EffectivePCConfig {
  /** Scaled inference rate for the settling loop. */
  inferenceRate: number;
  /** Scaled energy threshold for convergence detection. */
  energyThreshold: number;
  /** Scaled learning rate for Hebbian weight updates. */
  learningRate: number;
}

/**
 * Computes effective PC parameters scaled for the creature's topology.
 *
 * For small networks (≤10 hidden neurons), returns the config values as-is.
 * For larger networks, applies adaptive scaling:
 *
 * - **inferenceRate**: Scaled by `1 / sqrt(hiddenCount / SCALING_THRESHOLD)`
 *   to prevent oscillation from large gradient sums.
 * - **energyThreshold**: Scaled by `nonInputCount / SCALING_THRESHOLD` so
 *   convergence remains achievable as more neurons contribute to total energy.
 * - **learningRate**: Scaled by `sqrt(hiddenCount / SCALING_THRESHOLD)` so
 *   weight updates remain meaningful across many parameters.
 *
 * @param creature The creature whose topology determines scaling.
 * @param config The user-specified or default PC configuration.
 * @returns Effective PC parameters for inference and learning.
 */
export function computeEffectiveConfig(
  creature: Creature,
  config: RequiredPredictiveCodingConfig,
): EffectivePCConfig {
  let hiddenCount = 0;
  let nonInputCount = 0;

  for (const neuron of creature.neurons) {
    if (neuron.type === "hidden") hiddenCount++;
    if (neuron.type !== "input") nonInputCount++;
  }

  // No scaling for small networks.
  if (hiddenCount <= SCALING_THRESHOLD) {
    return {
      inferenceRate: config.inferenceRate,
      energyThreshold: config.energyThreshold,
      learningRate: config.learningRate,
    };
  }

  const hiddenRatio = hiddenCount / SCALING_THRESHOLD;
  const nonInputRatio = Math.max(1, nonInputCount / SCALING_THRESHOLD);

  return {
    // Scale down to prevent oscillation from large gradient sums.
    inferenceRate: config.inferenceRate / Math.sqrt(hiddenRatio),
    // Scale up so convergence is achievable with more error terms.
    energyThreshold: config.energyThreshold * nonInputRatio,
    // Scale up so weight updates remain meaningful across many parameters.
    learningRate: config.learningRate * Math.sqrt(hiddenRatio),
  };
}
