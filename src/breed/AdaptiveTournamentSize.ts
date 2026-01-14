/**
 * Adaptive Tournament Selection Size (Issue #1019)
 *
 * This module provides functions to calculate tournament selection size
 * that scales with population size for better evolution efficiency.
 *
 * The formula balances exploration and exploitation:
 * - Small populations: tournament size is limited by population size
 * - Medium populations: roughly sqrt(population) for balanced pressure
 * - Large populations: capped at ~10% to avoid excessive selection pressure
 *
 * Research Context:
 * Tournament selection pressure is well-studied in evolutionary computation.
 * Larger tournaments increase selection pressure (favour best), while smaller
 * tournaments increase exploration (more random selection). Adaptive sizing
 * balances these factors based on population dynamics.
 *
 * @see https://en.wikipedia.org/wiki/Selection_(genetic_algorithm)#Tournament_Selection
 */

/**
 * Calculates the adaptive tournament size based on population size.
 *
 * The formula uses:
 * - Minimum size of 3 (ensures meaningful selection pressure)
 * - Square root scaling for moderate selection pressure
 * - 10% cap to prevent excessive pressure in large populations
 *
 * @param populationSize - The current population size
 * @returns The recommended tournament size
 *
 * @example
 * ```ts
 * // Small population
 * calculateAdaptiveTournamentSize(10);  // Returns 3
 *
 * // Medium population
 * calculateAdaptiveTournamentSize(100); // Returns ~10 (sqrt(100))
 *
 * // Large population
 * calculateAdaptiveTournamentSize(1000); // Returns ~31 (sqrt(1000))
 * ```
 */
export function calculateAdaptiveTournamentSize(
  populationSize: number,
): number {
  // Handle edge cases for very small populations
  if (populationSize <= 2) {
    return populationSize;
  }

  // Calculate size using sqrt scaling capped at 10%
  // Formula: max(3, min(floor(sqrt(population)), floor(population * 0.1)))
  const sqrtSize = Math.floor(Math.sqrt(populationSize));
  const percentSize = Math.floor(populationSize * 0.1);

  // Take the minimum of sqrt and percentage to balance pressure
  const scaledSize = Math.min(sqrtSize, percentSize);

  // Ensure minimum tournament size of 3 for meaningful selection
  return Math.max(3, scaledSize);
}
