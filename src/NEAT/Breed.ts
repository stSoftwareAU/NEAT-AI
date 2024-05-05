import { Creature, Selection } from "../../mod.ts";
import { Offspring } from "../architecture/Offspring.ts";
import { NeatConfig } from "../config/NeatConfig.ts";

export class Breed {
  private population: Creature[];
  readonly config: NeatConfig;

  constructor(population: Creature[], config: NeatConfig) {
    this.population = population;
    this.config = config;
  }
  /**
   * Breeds two parents into an offspring, population MUST be sorted
   */
  breed(): Creature | undefined {
    const mum = this.getParent();

    if (mum === undefined) {
      console.warn(
        "No mother found",
        this.config.selection.name,
        this.population.length,
      );

      for (let pos = 0; pos < this.population.length; pos++) {
        console.info(pos, this.population[pos] ? true : false);
      }
      for (let pos = 0; pos < this.population.length; pos++) {
        if (this.population[pos]) return this.population[pos];
      }
      throw new Error(`Extinction event`);
    }

    let dad = this.getParent();
    for (let i = 0; i < 12; i++) {
      dad = this.getParent();
      if (mum !== dad) break;
    }

    if (dad === undefined) {
      console.warn(
        "No father found",
        this.config.selection.name,
        this.population.length,
      );

      for (let pos = 0; pos < this.population.length; pos++) {
        if (this.population[pos]) return this.population[pos];
      }

      throw new Error(`Extinction event`);
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      const creature = Offspring.breed(
        mum,
        dad,
      );
      if (creature) {
        return creature;
      }
    }
    return undefined;
  }

  /**
   * Gets a parent based on the selection function
   * @return {Creature} parent
   */
  getParent(): Creature {
    switch (this.config.selection) {
      case Selection.POWER: {
        const r = Math.random();
        const index = Math.floor(
          Math.pow(r, Selection.POWER.power) *
            this.population.length,
        );

        return this.population[index];
      }
      case Selection.FITNESS_PROPORTIONATE: {
        /**
         * As negative fitnesses are possible
         * https://stackoverflow.com/questions/16186686/genetic-algorithm-handling-negative-fitness-values
         * this is unnecessarily run for every individual, should be changed
         */

        let totalFitness = 0;
        let minimalFitness = 0;
        for (let i = this.population.length; i--;) {
          const tmpScore = this.population[i].score;
          const score = tmpScore === undefined ? Infinity * -1 : tmpScore;
          minimalFitness = score < minimalFitness ? score : minimalFitness;
          totalFitness += score;
        }

        const adjustFitness = Math.abs(minimalFitness);
        totalFitness += adjustFitness * this.population.length;

        const random = Math.random() * totalFitness;
        let value = 0;

        for (let i = 0; i < this.population.length; i++) {
          const genome = this.population[i];
          if (genome.score !== undefined) {
            value += genome.score + adjustFitness;
            if (random < value) {
              return genome;
            }
          }
        }

        // if all scores equal, return random genome
        return this
          .population[
            Math.floor(Math.random() * this.population.length)
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
          const random = this.population[
            Math.floor(Math.random() * this.population.length)
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
