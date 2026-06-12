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
 * Tunable bounds for {@link calculateAdaptiveTournamentSize} (Issue #2929).
 *
 * The defaults reproduce the prior hardcoded formula
 * `max(3, min(floor(sqrt(pop)), floor(pop * 0.1)))` exactly.
 */
export interface AdaptiveTournamentBounds {
  /** Minimum tournament size (default: 3). */
  minSize?: number;
  /**
   * Population scaling exponent: `floor(population ^ exponent)`. The default
   * `0.5` reproduces square-root scaling.
   */
  sqrtExponent?: number;
  /** Cap as a fraction of population: `floor(population * fraction)` (default: 0.1). */
  capFraction?: number;
}

const DEFAULT_MIN_SIZE = 3;
const DEFAULT_SQRT_EXPONENT = 0.5;
const DEFAULT_CAP_FRACTION = 0.1;

/**
 * Calculates the adaptive tournament size based on population size.
 *
 * The formula uses:
 * - A minimum size (default 3) ensuring meaningful selection pressure
 * - Exponent scaling for moderate selection pressure (default 0.5 → sqrt)
 * - A population-fraction cap (default 10%) preventing excessive pressure
 *
 * All three bounds are tunable via the optional {@link AdaptiveTournamentBounds}
 * argument (Issue #2929); omitting it reproduces the prior behaviour exactly.
 *
 * @param populationSize - The current population size
 * @param bounds - Optional tunable bounds (defaults reproduce prior behaviour)
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
  bounds?: AdaptiveTournamentBounds,
): number {
  // Handle edge cases for very small populations
  if (populationSize <= 2) {
    return populationSize;
  }

  const minSize = bounds?.minSize ?? DEFAULT_MIN_SIZE;
  const sqrtExponent = bounds?.sqrtExponent ?? DEFAULT_SQRT_EXPONENT;
  const capFraction = bounds?.capFraction ?? DEFAULT_CAP_FRACTION;

  // Calculate size using exponent scaling capped at a population fraction.
  // Formula: max(minSize, min(floor(pop ^ exponent), floor(pop * fraction)))
  // Use Math.sqrt for the default exponent so results are bit-for-bit
  // identical to the prior implementation (Math.pow may differ by 1 ULP).
  const scaledRaw = sqrtExponent === DEFAULT_SQRT_EXPONENT
    ? Math.sqrt(populationSize)
    : Math.pow(populationSize, sqrtExponent);
  const sqrtSize = Math.floor(scaledRaw);
  const percentSize = Math.floor(populationSize * capFraction);

  // Take the minimum of exponent-scaled and fraction-capped sizes
  const scaledSize = Math.min(sqrtSize, percentSize);

  // Ensure the configured minimum tournament size for meaningful selection
  return Math.max(minSize, scaledSize);
}
