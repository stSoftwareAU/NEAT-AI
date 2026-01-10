import { assert } from "@std/assert";
import { Creature, type NeatOptions, Selection } from "../../mod.ts";
import { Offspring } from "../architecture/Offspring.ts";
import { discover } from "../blackbox/Discover.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import type { Genus } from "../NEAT/Genus.ts";
import { createCompatibleFather } from "./Father.ts";
import { FitnessRanking } from "./FitnessRanking.ts";

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
 *   console.log("New offspring created");
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

    const mum = this.selectParent(populationRanking, config);

    assert(mum, "Mother is undefined");

    const dad = this.getDad(mum, config);
    if (!dad) {
      console.warn(
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

  /**
   * Selects a father for breeding with the given mother.
   *
   * Creates a FitnessRanking for the filtered father population to enable
   * efficient parent selection.
   *
   * @param mum - The mother creature
   * @param config - NEAT configuration
   * @returns A compatible father creature, or undefined if none found
   */
  private getDad(
    mum: Creature,
    config: NeatConfig,
  ): Creature | undefined {
    assert(mum.uuid, "Mother UUID is undefined");

    let possibleFathers: Creature[] = [];

    if (config.globalBreedingRate > Math.random()) {
      possibleFathers = this.genus.population.filter((creature) =>
        creature.uuid !== mum.uuid
      );
    }

    if (possibleFathers.length === 0) {
      const species = this.genus.findSpeciesByCreatureUUID(mum.uuid);

      possibleFathers = species.creatures.filter((creature) =>
        creature.uuid !== mum.uuid
      );

      if (possibleFathers.length === 0) {
        const closestSpecies = this.genus.findClosestMatchingSpecies(mum);
        if (closestSpecies) {
          possibleFathers = closestSpecies.creatures;

          if (possibleFathers.length === 0) {
            possibleFathers = this.genus.population.filter((creature) =>
              creature.uuid !== mum.uuid
            );
          }
        }
      }
    }

    if (possibleFathers.length === 0) {
      return undefined;
    }

    // Create a new FitnessRanking for the filtered father population
    const fatherRanking = new FitnessRanking(possibleFathers);
    const father = this.selectParent(fatherRanking, config);
    assert(father !== undefined, "Father is undefined");

    const fatherExport = createCompatibleFather(
      mum.exportJSON(),
      father.exportJSON(),
    );
    try {
      const compatibleFather = Creature.fromJSON(
        fatherExport,
      );

      return compatibleFather;
    } catch (e) {
      Deno.writeTextFileSync(
        "./.source_mother.json",
        JSON.stringify(mum.exportJSON(), null, 1),
      );
      Deno.writeTextFileSync(
        "./.source_father.json",
        JSON.stringify(father.exportJSON(), null, 1),
      );

      Deno.writeTextFileSync(
        "./.invalid_father.json",
        JSON.stringify(fatherExport, null, 1),
      );
      throw e;
    }
  }

  /**
   * Selects a parent from a pre-computed fitness ranking based on the selection strategy.
   *
   * Uses the pre-computed FitnessRanking for O(1) or O(k) selection instead of
   * recalculating fitness metrics on every selection.
   *
   * @param ranking - Pre-computed fitness ranking
   * @param config - NEAT configuration
   * @returns The selected parent creature
   * @throws {Error} When selection fails or unknown selection strategy
   */
  private selectParent(ranking: FitnessRanking, config: NeatConfig): Creature {
    switch (config.selection) {
      case Selection.POWER: {
        return ranking.selectPower(Selection.POWER.power);
      }
      case Selection.FITNESS_PROPORTIONATE: {
        return ranking.selectFitnessProportionate();
      }
      case Selection.TOURNAMENT: {
        assert(
          Selection.TOURNAMENT.size <= config.populationSize,
          "Your tournament size should be lower than the population size, please change Selection.TOURNAMENT.size",
        );

        return ranking.selectTournament(
          Selection.TOURNAMENT.size,
          Selection.TOURNAMENT.probability,
        );
      }
      default: {
        throw new Error(`Unknown selection: ${config.selection}`);
      }
    }
  }
}
