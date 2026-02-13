import { assert } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";

/**
 * Pre-computed fitness ranking data for a population.
 *
 * This class computes and caches fitness metrics once per generation,
 * enabling O(1) or O(k) parent selection instead of O(n) per selection.
 *
 * Key optimizations:
 * - Sorted population computed once
 * - Total fitness computed once
 * - Min/max fitness computed once
 * - Score lookup via Map for O(1) access
 *
 * @example
 * ```ts
 * const ranking = new FitnessRanking(population);
 * const parent1 = ranking.selectFitnessProportionate();
 * const parent2 = ranking.selectPower(4);
 * ```
 */
export class FitnessRanking {
  /** Population sorted by fitness score in descending order (highest first) */
  readonly sortedPopulation: readonly Creature[];

  /** Sum of all fitness scores */
  readonly totalFitness: number;

  /** Minimum fitness score in the population */
  readonly minFitness: number;

  /** Total fitness adjusted for negative scores (all scores shifted to positive) */
  readonly adjustedTotalFitness: number;

  /** Map from creature UUID to fitness score for O(1) lookup */
  private readonly scoreMap: Map<string, number>;

  /**
   * Creates a new FitnessRanking from a population.
   *
   * @param population - The population of creatures to rank
   * @throws {Error} When population is empty
   */
  constructor(population: Creature[]) {
    if (population.length === 0) {
      throw new Error("Population cannot be empty");
    }

    // Build score map and compute metrics in a single pass
    this.scoreMap = new Map<string, number>();
    let totalFitness = 0;
    let minFitness = 0;
    let lastScore = Number.POSITIVE_INFINITY;
    let sorted = true;

    for (let i = 0; i < population.length; i++) {
      const creature = population[i];
      assert(creature.uuid, "Creature UUID is undefined");

      const score = this.extractScore(creature);
      this.scoreMap.set(creature.uuid, score);

      if (lastScore < score) {
        sorted = false;
      }
      lastScore = score;

      if (score < minFitness) {
        minFitness = score;
      }
      totalFitness += score;
    }

    this.minFitness = minFitness;
    this.totalFitness = totalFitness;

    // Sort population if not already sorted (descending by score)
    if (sorted) {
      this.sortedPopulation = population;
    } else {
      this.sortedPopulation = population.slice().sort((a, b) => {
        return this.scoreMap.get(b.uuid!)! - this.scoreMap.get(a.uuid!)!;
      });
    }

    // Compute adjusted total fitness (shift all scores to be positive)
    const adjustFitness = Math.abs(minFitness);
    this.adjustedTotalFitness = totalFitness +
      adjustFitness * population.length;
  }

  /**
   * Extracts the fitness score from a creature.
   * Checks creature.score first, then falls back to the "score" tag.
   *
   * @param creature - The creature to extract score from
   * @returns The fitness score (NEGATIVE_INFINITY if not found)
   */
  private extractScore(creature: Creature): number {
    if (Number.isFinite(creature.score)) {
      return creature.score!;
    }

    const scoreTxt = getTag(creature, "score");
    if (scoreTxt) {
      const score = parseFloat(scoreTxt);
      if (Number.isFinite(score)) {
        return score;
      }
    }

    return Number.NEGATIVE_INFINITY;
  }

  /**
   * Gets the fitness score for a creature by UUID.
   *
   * @param uuid - The UUID of the creature
   * @returns The fitness score
   * @throws {Error} When UUID not found in ranking
   */
  getScore(uuid: string): number {
    const score = this.scoreMap.get(uuid);
    assert(score !== undefined, `UUID ${uuid} not found in ranking`);
    return score;
  }

  /**
   * Selects a parent using power selection.
   *
   * Power selection biases towards better-ranked individuals
   * by raising a random number to a power before using it as an index.
   *
   * @param power - The power exponent (higher = more bias towards top)
   * @returns The selected creature
   */
  selectPower(power: number): Creature {
    const rng = getRandomNumberGenerator();
    const r = rng.random();
    const index = Math.floor(
      Math.pow(r, power) * this.sortedPopulation.length,
    );
    return this.sortedPopulation[index];
  }

  /**
   * Selects a parent using fitness proportionate (roulette wheel) selection.
   *
   * Each individual's selection probability is proportional to their fitness.
   * Negative fitness scores are shifted to ensure all probabilities are positive.
   *
   * @returns The selected creature
   */
  selectFitnessProportionate(): Creature {
    const rng = getRandomNumberGenerator();
    const adjustFitness = Math.abs(this.minFitness);
    const random = rng.random() * this.adjustedTotalFitness;
    let value = 0;

    for (let i = 0; i < this.sortedPopulation.length; i++) {
      const creature = this.sortedPopulation[i];
      value += this.scoreMap.get(creature.uuid!)! + adjustFitness;
      if (random < value) {
        return creature;
      }
    }

    // If all scores equal, return random creature
    return this.sortedPopulation[
      Math.floor(rng.random() * this.sortedPopulation.length)
    ];
  }

  /**
   * Selects a parent using tournament selection.
   *
   * A random subset of individuals is chosen, then the best individual
   * from this subset is selected with some probability. If not selected,
   * the next best is considered, and so on.
   *
   * @param size - Number of individuals in the tournament
   * @param probability - Probability of selecting the best individual
   * @returns The selected creature
   * @throws {Error} When no parent found in tournament
   */
  selectTournament(size: number, probability: number): Creature {
    const rng = getRandomNumberGenerator();
    const actualSize = Math.min(size, this.sortedPopulation.length);

    // Create tournament participants
    const participants = new Array<Creature>(actualSize);
    for (let i = 0; i < actualSize; i++) {
      const randomIdx = Math.floor(
        rng.random() * this.sortedPopulation.length,
      );
      participants[i] = this.sortedPopulation[randomIdx];
    }

    // Sort participants by score (descending)
    participants.sort((a, b) => {
      return this.scoreMap.get(b.uuid!)! - this.scoreMap.get(a.uuid!)!;
    });

    // Select with probability
    for (let i = 0; i < actualSize; i++) {
      if (rng.random() < probability || i === actualSize - 1) {
        return participants[i];
      }
    }

    throw new Error("No parent found in tournament");
  }
}
