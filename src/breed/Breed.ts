import { Creature, Selection } from "../../mod.ts";
import { Offspring } from "../architecture/Offspring.ts";
import type { NeatConfig } from "../config/NeatConfig.ts";
import type { Genus } from "../NEAT/Genus.ts";
import { createCompatibleFather } from "./Father.ts";

export class Breed {
  readonly genus: Genus;
  readonly config: NeatConfig;

  constructor(genus: Genus, config: NeatConfig) {
    this.genus = genus;
    this.config = config;
  }

  /**
   * Breeds two parents into an offspring, population MUST be sorted
   */
  breed(): Creature | undefined {
    const mum = this.getParent(this.genus.population);

    if (mum === undefined) {
      console.warn(
        "No mother found",
        this.config.selection.name,
        this.genus.population.length,
      );

      return;
    }

    const dad = this.getDad(mum);
    if (dad === undefined) {
      console.warn(
        "No father found",
      );

      return;
    }

    const creature = Offspring.breed(
      mum,
      dad,
    );

    return creature;
  }

  private getDad(mum: Creature): Creature {
    if (!mum.uuid) throw new Error(`mum.uuid is undefined`);

    const species = this.genus.findSpeciesByCreatureUUID(mum.uuid);

    let possibleFathers = species.creatures.filter((creature) =>
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

    const father = this.getParent(possibleFathers);

    return Creature.fromJSON(
      createCompatibleFather(mum.exportJSON(), father.exportJSON()),
    );
  }

  /**
   * Gets a parent based on the selection function
   * @return {Creature} parent
   */
  private getParent(population: Creature[]): Creature {
    switch (this.config.selection) {
      case Selection.POWER: {
        const r = Math.random();
        const index = Math.floor(
          Math.pow(r, Selection.POWER.power) *
            population.length,
        );

        return population[index];
      }
      case Selection.FITNESS_PROPORTIONATE: {
        /**
         * As negative fitnesses are possible
         * https://stackoverflow.com/questions/16186686/genetic-algorithm-handling-negative-fitness-values
         * this is unnecessarily run for every individual, should be changed
         */

        let totalFitness = 0;
        let minimalFitness = 0;
        for (let i = population.length; i--;) {
          const tmpScore = population[i].score;
          const score = tmpScore === undefined ? Infinity * -1 : tmpScore;
          minimalFitness = score < minimalFitness ? score : minimalFitness;
          totalFitness += score;
        }

        const adjustFitness = Math.abs(minimalFitness);
        totalFitness += adjustFitness * population.length;

        const random = Math.random() * totalFitness;
        let value = 0;

        for (let i = 0; i < population.length; i++) {
          const genome = population[i];
          if (genome.score !== undefined) {
            value += genome.score + adjustFitness;
            if (random < value) {
              return genome;
            }
          }
        }

        // if all scores equal, return random genome
        return population[
          Math.floor(Math.random() * population.length)
        ];
      }
      case Selection.TOURNAMENT: {
        if (Selection.TOURNAMENT.size > this.config.populationSize) {
          throw new Error(
            "Your tournament size should be lower than the population size, please change Selection.TOURNAMENT.size",
          );
        }

        // Create a tournament
        const individuals = new Array(Selection.TOURNAMENT.size);
        for (let i = 0; i < Selection.TOURNAMENT.size; i++) {
          const random = population[
            Math.floor(Math.random() * population.length)
          ];
          individuals[i] = random;
        }

        // Sort the tournament individuals by score
        individuals.sort(function (a, b) {
          return b.score - a.score;
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
        throw new Error(`Unknown selection: ${this.config.selection}`);
      }
    }
  }
}
