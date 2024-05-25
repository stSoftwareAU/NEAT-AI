/**
 * Interface for defining selection strategies in genetic algorithms.
 */
export interface SelectionInterface {
  /** Name of the selection strategy. */
  name: string;
}

/**
 * Selection strategies used in genetic algorithms.
 *
 * https://en.wikipedia.org/wiki/Selection_(genetic_algorithm)
 */
export const Selection = {
  /**
   * Fitness proportionate selection, also known as roulette wheel selection.
   * Individuals are selected based on their fitness proportion relative to the population.
   */
  FITNESS_PROPORTIONATE: {
    name: "FITNESS_PROPORTIONATE",
  },
  /**
   * Power selection, a variant of fitness proportionate selection.
   * Fitness values are raised to a power before selection.
   *
   * @property {number} power - The power to which fitness values are raised.
   */
  POWER: {
    name: "POWER",
    power: 4,
  },
  /**
   * Tournament selection.
   * A subset of individuals is randomly chosen, and the best individual from this subset is selected.
   *
   * @property {number} size - The number of individuals in each tournament.
   * @property {number} probability - The probability of selecting the best individual in the tournament.
   */
  TOURNAMENT: {
    name: "TOURNAMENT",
    size: 5,
    probability: 0.5,
  },
};
