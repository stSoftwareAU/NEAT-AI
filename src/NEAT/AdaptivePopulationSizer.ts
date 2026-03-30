/**
 * AdaptivePopulationSizer.ts - Adjusts population size based on diversity and convergence.
 *
 * Issue #1863: Automatically adjust population size based on diversity
 * metrics and convergence progress.
 */

import type { RequiredAdaptivePopulationConfig } from "@config/AdaptivePopulationConfig.ts";
import { computeSpeciesDiversity } from "@neat/HyperparameterEvolution.ts";

/**
 * Computes the effective population size based on diversity and convergence.
 *
 * - If diversity is low (converging too quickly), increase population size.
 * - If diversity is high but fitness is stagnating, decrease population size.
 * - Otherwise, maintain current size.
 *
 * @param basePopulationSize - The configured base population size.
 * @param currentPopulationSize - The current effective population size.
 * @param speciesCount - Number of distinct species.
 * @param onPlateau - Whether the population is on a fitness plateau.
 * @param config - Adaptive population configuration.
 * @returns The new effective population size (integer).
 */
export function computeAdaptivePopulationSize(
  basePopulationSize: number,
  currentPopulationSize: number,
  speciesCount: number,
  onPlateau: boolean,
  config: RequiredAdaptivePopulationConfig,
): number {
  if (!config.enabled) {
    return basePopulationSize;
  }

  const diversity = computeSpeciesDiversity(
    speciesCount,
    currentPopulationSize,
  );

  const minSize = Math.max(
    2,
    Math.round(basePopulationSize * config.minPopulationFraction),
  );
  const maxSize = Math.round(
    basePopulationSize * config.maxPopulationFraction,
  );

  let targetSize = currentPopulationSize;

  if (diversity < config.lowDiversityThreshold) {
    // Low diversity: population is converging too quickly. Grow.
    const growAmount = Math.max(
      1,
      Math.round(basePopulationSize * config.adjustmentRate),
    );
    targetSize = currentPopulationSize + growAmount;
  } else if (diversity > config.highDiversityThreshold && onPlateau) {
    // High diversity but stagnating: population is too spread out. Shrink.
    const shrinkAmount = Math.max(
      1,
      Math.round(basePopulationSize * config.adjustmentRate),
    );
    targetSize = currentPopulationSize - shrinkAmount;
  }
  // else: Normal range — keep current size.

  // Clamp within bounds
  return Math.max(minSize, Math.min(maxSize, targetSize));
}
