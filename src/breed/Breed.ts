import { assert } from "@std/assert";
import type { Creature, NeatOptions } from "../../mod.ts";
import { Offspring } from "../architecture/Offspring.ts";
import { discover } from "../blackbox/Discover.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import type { Genus } from "../NEAT/Genus.ts";
import { FitnessRanking } from "./FitnessRanking.ts";
import { findFather, selectParent } from "./ParentSelection.ts";
import { getLogger } from "../utils/Logger.ts";

/**
 * Handles breeding operations between creatures in a NEAT population.
 *
 * This class manages the breeding process by selecting parents based on
 * fitness scores and genetic compatibility, then creating offspring through
 * crossover and mutation operations.
 *
 * Key features:
 * - Parent selection using various selection strategies
 * - Genetic compatibility checking
 * - Offspring creation with discovery integration
 * - Species-based breeding constraints
 *
 * @example
 * ```ts
 * const breed = new Breed(genus, config);
 * const offspring = breed.breed();
 * if (offspring) {
 *   getLogger().info("New offspring created");
 * }
 * ```
 */
export class Breed {
  /** The genus containing the population to breed from */
  readonly genus: Genus;
  /** Configuration options for breeding operations */
  readonly options: NeatOptions;

  /**
   * Creates a new Breed instance.
   *
   * @param genus - The genus containing the population
   * @param config - NEAT configuration options
   */
  constructor(genus: Genus, config: NeatConfig) {
    this.genus = genus;
    this.options = { ...config };
  }

  /**
   * Breeds two parents into an offspring.
   *
   * This method selects a mother and father from the population based on
   * fitness scores and genetic compatibility, then creates an offspring
   * through crossover and mutation. The population must be sorted by fitness.
   *
   * Uses pre-computed FitnessRanking for efficient parent selection,
   * computing fitness metrics once per breeding call instead of on every
   * parent selection.
   *
   * @returns A new offspring creature, or undefined if breeding fails
   * @throws {Error} When mother selection fails or father compatibility issues occur
   */
  breed(): Creature | undefined {
    const config = createNeatConfig(this.options);

    // Pre-compute fitness ranking once for the entire population
    const populationRanking = new FitnessRanking(this.genus.population);

    const mum = selectParent(populationRanking, config);

    assert(mum, "Mother is undefined");

    const dad = findFather(mum, this.genus, config);
    if (!dad) {
      getLogger().warn(
        "No father found",
      );

      return;
    }

    const child = Offspring.breed(
      mum,
      dad,
      {
        geneticCompatibilityThreshold: config.geneticCompatibilityThreshold,
        forwardOnly: config.feedbackLoop !== true,
      },
    );

    if (child && !child.memetic) {
      discover(mum, child);
    }

    return child;
  }
}
