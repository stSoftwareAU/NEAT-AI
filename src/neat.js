/* Import */
import { Network } from "./architecture/network.js";
import { fineTuneImprovement } from "./architecture/FineTune.ts";
import { Methods } from "./methods/methods.js";
import { Mutation } from "./methods/mutation.ts";
import { make as makeConfig } from "./config.ts";
import { makeElitists } from "../src/architecture/elitism.ts";
import { addTag, getTag } from "../src/tags/TagsInterface.ts";

/* Easier variable naming */
const selection = Methods.selection;

/*******************************************************************************
                                         NEAT
*******************************************************************************/
export class Neat {
  constructor(input, output, fitness, options) {
    this.input = input; // The input size of the networks
    this.output = output; // The output size of the networks
    this.fitness = fitness; // The fitness function to evaluate the networks

    this.config = makeConfig(options);

    // Generation counter
    this.generation = 0;

    //@TODO use fitness population
    // Initialise the genomes
    this.createPool(this.config.network);
  }

  /**
   * Create the initial pool of genomes
   */
  createPool(network) {
    this.population = [];

    for (let i = 0; i < this.config.popsize; i++) {
      let copy;
      if (network) {
        copy = Network.fromJSON(network.toJSON());
      } else {
        copy = new Network(this.input, this.output);
      }
      delete copy.score;
      this.population.push(copy);
    }
  }

  /**
   * Evaluates, selects, breeds and mutates population
   */
  async evolve(previousFittest) {
    if (this.config.warnings) {
      // Check if evaluated, sort the population
      if (
        typeof this.population[this.population.length - 1].score !== "undefined"
      ) {
        console.log("already evaluated");
      }
    }

    await this.evaluate();

    // Elitism
    const elitists = makeElitists(this.population, this.config.elitism);
    const tmpFittest = elitists[0];

    const fittest = Network.fromJSON(tmpFittest.toJSON()); // Make a copy so it's not mutated.
    fittest.score = tmpFittest.score;
    addTag(fittest, "score", fittest.score.toString());
    addTag(fittest, "error", getTag(fittest, "error"));

    if (this.config.warnings) {
      if (isFinite(fittest.score) == false) {
        for (let i = 0; i < this.population.length; i++) {
          console.warn(
            "this.population[" + i + "].score",
            this.population[i].score,
          );
          console.warn(
            "this.population[" + i + "]",
            this.population[i].toJSON(),
          );
        }
        console.warn("fittest", fittest);
        throw "Infinite score";
      }
    }

    const livePopulation = [];
    for (let i = 0; i < this.population.length; i++) {
      const p = this.population[i];
      if (isFinite(p.score)) {
        livePopulation.push(p);
      }
    }

    if (this.population.length !== livePopulation.length) {
      console.info(
        "Removed",
        this.population.length - livePopulation.length,
        "dead creatures",
      );
    }

    this.population = livePopulation;

    const fineTunedPopulation = fineTuneImprovement(
      fittest,
      previousFittest,
      /** 20% of population or those that just died */
      Math.max(
        Math.ceil(this.config.popsize / 5),
        this.config.popsize - this.population.length,
      ),
    );

    const newPopulation = [];

    // Breed the next individuals
    for (
      let i = this.config.popsize - this.config.elitism -
        fineTunedPopulation.length;
      i--;
    ) {
      newPopulation.push(this.getOffspring());
    }

    // Replace the old population with the new population
    this._mutate(newPopulation);

    this.population = [...elitists, ...fineTunedPopulation, ...newPopulation]; // Keep pseudo sorted.

    const unique = new Set();
    /**
     *  Reset the scores & de-duplcate the population.
     */
    for (let i = 0; i < this.population.length; i++) {
      const p = this.population[i];
      const key = JSON.stringify(p);
      if (unique.has(key)) {
        for (let j = 0; j < 100; j++) {
          const tmpPopulation = [this.getOffspring()];
          this._mutate(tmpPopulation);

          const p2 = tmpPopulation[0];
          const key2 = JSON.stringify(p2);
          if (unique.has(key2) == false) {
            this.population[i] = p2;
            unique.add(key2);
            break;
          }
        }
      } else {
        unique.add(key);
        delete p.score;
      }
    }

    this.generation++;

    return fittest;
  }
  /**
   * Breeds two parents into an offspring, population MUST be sorted
   */
  getOffspring() {
    return Network.crossOver(
      this.getParent(),
      this.getParent(),
      this.config.equal,
    );
  }
  /**
   * Selects a random mutation method for a genome according to the parameters
   */
  selectMutationMethod(genome) {
    const mutationMethod = this.config
      .mutation[Math.floor(Math.random() * this.config.mutation.length)];

    if (
      mutationMethod === Mutation.ADD_NODE &&
      genome.nodes.length >= this.config.maxNodes
    ) {
      if (this.config.warnings) {
        console.warn("maxNodes exceeded!");
      }
      return;
    }

    if (
      mutationMethod === Mutation.ADD_CONN &&
      genome.connections.length >= this.config.maxConns
    ) {
      if (this.config.warnings) {
        console.warn("maxConns exceeded!");
      }
      return;
    }

    if (
      mutationMethod === Mutation.ADD_GATE &&
      genome.gates.length >= this.config.maxGates
    ) {
      if (this.config.warnings) {
        console.warn("maxGates exceeded!");
      }
      return;
    }

    return mutationMethod;
  }
  /**
   * Mutates the given (or current) population
   */
  _mutate(genes) {
    for (let i = genes.length; i--;) {
      // const pos = index[i];
      if (Math.random() <= this.config.mutationRate) {
        const gene = genes[i];
        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(gene);
          gene.mutate(mutationMethod);
        }
      }
    }
  }

  /**
   * Evaluates the current population
   */
  async evaluate() {
    if (this.config.clear) {
      for (let i = this.population.length; i--;) {
        this.population[i].clear();
      }
    }

    try {
      await this.fitness(this.population);
    } catch (e) {
      console.error("fitness error", e);
      throw e;
    }
  }
  /**
   * Gets a genome based on the selection function
   * @return {Network} genome
   */
  getParent() {
    switch (this.config.selection) {
      case selection.POWER: {
        if (this.population[0].score < this.population[1].score) {
          console.trace();
          throw "Not Sorted";
        }

        const index = Math.floor(
          Math.pow(Math.random(), this.config.selection.power) *
            this.population.length,
        );
        return this.population[index];
      }
      case selection.FITNESS_PROPORTIONATE: {
        // As negative fitnesses are possible
        // https://stackoverflow.com/questions/16186686/genetic-algorithm-handling-negative-fitness-values
        // this is unnecessarily run for every individual, should be changed
        let totalFitness = 0;
        let minimalFitness = 0;
        for (let i = this.population.length; i--;) {
          const score = this.population[i].score;
          minimalFitness = score < minimalFitness ? score : minimalFitness;
          totalFitness += score;
        }

        const adjustFitness = Math.abs(minimalFitness);
        totalFitness += adjustFitness * this.population.length;

        const random = Math.random() * totalFitness;
        let value = 0;

        for (let i = 0; i < this.population.length; i++) {
          const genome = this.population[i];
          value += genome.score + adjustFitness;
          if (random < value) {
            return genome;
          }
        }

        // if all scores equal, return random genome
        return this
          .population[Math.floor(Math.random() * this.population.length)];
      }
      case selection.TOURNAMENT: {
        if (this.config.selection.size > this.config.popsize) {
          throw new Error(
            "Your tournament size should be lower than the population size, please change methods.selection.TOURNAMENT.size",
          );
        }

        // Create a tournament
        const individuals = new Array(this.config.selection.size);
        for (let i = 0; i < this.config.selection.size; i++) {
          const random =
            this.population[Math.floor(Math.random() * this.population.length)];
          individuals[i] = random;
        }

        // Sort the tournament individuals by score
        individuals.sort(function (a, b) {
          return b.score - a.score;
        });

        // Select an individual
        for (let i = 0; i < this.config.selection.size; i++) {
          if (
            Math.random() < this.config.selection.probability ||
            i === this.config.selection.size - 1
          ) {
            return individuals[i];
          }
        }
      }
    }
  }
}
