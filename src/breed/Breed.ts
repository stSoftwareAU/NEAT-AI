import { assert } from "@std/assert";
import { getTag } from "@stsoftware/tags/mod";
import { Creature, type NeatOptions, Selection } from "../../mod.ts";
import { Offspring } from "../architecture/Offspring.ts";
import { discover } from "../blackbox/Discover.ts";
import { createNeatConfig, type NeatConfig } from "../config/NeatConfig.ts";
import type { Genus } from "../NEAT/Genus.ts";
import { createCompatibleFather } from "./Father.ts";

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
   * @returns A new offspring creature, or undefined if breeding fails
   * @throws {Error} When mother selection fails or father compatibility issues occur
   */
  breed(): Creature | undefined {
    const config = createNeatConfig(this.options);
    const mum = this.getParent(this.genus.population, config);

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

  private getDad(mum: Creature, config: NeatConfig): Creature | undefined {
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
    const father = this.getParent(possibleFathers, config);
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
   * Gets a parent based on the selection function
   * @return {Creature} parent
   */
  private getParent(population: Creature[], config: NeatConfig): Creature {
    // Assert all creatures have valid fitness scores
    const claimedScores = new Map<string, number>();
    let lastScore = Number.POSITIVE_INFINITY;
    let sorted = true;
    population.forEach((creature) => {
      assert(creature.uuid, "Creature UUID is undefined");

      if (Number.isFinite(creature.score)) {
        if (lastScore < creature.score!) {
          sorted = false;
        }
        lastScore = creature.score!;
        claimedScores.set(creature.uuid, creature.score!);
      } else {
        const scoreTxt = getTag(creature, "score");
        if (scoreTxt) {
          const score = parseFloat(scoreTxt);

          if (Number.isFinite(score)) {
            if (lastScore < score) {
              sorted = false;
            }

            lastScore = score;
            claimedScores.set(creature.uuid, score);
          } else {
            lastScore = Number.NEGATIVE_INFINITY;
            claimedScores.set(creature.uuid, Number.NEGATIVE_INFINITY);
          }
        } else {
          lastScore = Number.NEGATIVE_INFINITY;
          claimedScores.set(creature.uuid, Number.NEGATIVE_INFINITY);
        }
      }
    });

    const sortedPopulation = sorted
      ? population
      : population.slice().sort((a, b) => {
        return claimedScores.get(b.uuid!)! - claimedScores.get(a.uuid!)!;
      });

    switch (config.selection) {
      case Selection.POWER: {
        const r = Math.random();
        const index = Math.floor(
          Math.pow(r, Selection.POWER.power) *
            sortedPopulation.length,
        );

        return sortedPopulation[index];
      }
      case Selection.FITNESS_PROPORTIONATE: {
        let totalFitness = 0;
        let minimalFitness = 0;

        for (let i = sortedPopulation.length; i--;) {
          const score = claimedScores.get(sortedPopulation[i].uuid!)!;
          minimalFitness = score < minimalFitness ? score : minimalFitness;
          totalFitness += score;
        }

        const adjustFitness = Math.abs(minimalFitness);
        totalFitness += adjustFitness * sortedPopulation.length;

        const random = Math.random() * totalFitness;
        let value = 0;

        for (let i = 0; i < sortedPopulation.length; i++) {
          const genome = sortedPopulation[i];
          value += claimedScores.get(genome.uuid!)! + adjustFitness;
          if (random < value) {
            return genome;
          }
        }

        /* If all scores equal, return random genome */
        return sortedPopulation[
          Math.floor(Math.random() * sortedPopulation.length)
        ];
      }
      case Selection.TOURNAMENT: {
        assert(
          Selection.TOURNAMENT.size <= config.populationSize,
          "Your tournament size should be lower than the population size, please change Selection.TOURNAMENT.size",
        );

        // Create a tournament
        const individuals = new Array(Selection.TOURNAMENT.size);
        for (let i = 0; i < Selection.TOURNAMENT.size; i++) {
          const random = sortedPopulation[
            Math.floor(Math.random() * sortedPopulation.length)
          ];
          individuals[i] = random;
        }

        // Sort the tournament individuals by score
        individuals.sort(function (a, b) {
          return claimedScores.get(b.uuid)! - claimedScores.get(a.uuid)!;
        });

        // Select an individual
        for (let i = 0; i < Selection.TOURNAMENT.size; i++) {
          if (
            Math.random() < Selection.TOURNAMENT.probability ||
            i === Selection.TOURNAMENT.size - 1
          ) {
            return individuals[i];
          }
        }
        throw new Error(`No parent found in tournament`);
      }
      default: {
        throw new Error(`Unknown selection: ${config.selection}`);
      }
    }
  }
}
