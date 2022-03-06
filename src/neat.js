/* Import */
import { Network } from "./architecture/network.js";
import { Methods } from "./methods/methods.js";
import { Mutation } from "./methods/mutation.ts";
import { Config } from "./config.ts";
import { makeElitists } from "../src/architecture/elitism.ts";
// import { shuffle } from "./architecture/DataSet.ts";

/* Easier variable naming */
const selection = Methods.selection;

/*******************************************************************************
                                         NEAT
*******************************************************************************/

export default function Neat(input, output, fitness, options) {
  this.input = input; // The input size of the networks
  this.output = output; // The output size of the networks
  this.fitness = fitness; // The fitness function to evaluate the networks

  // Configure options
  options = options || {};
  this.equal = options.equal || false;
  this.clear = options.clear || false;
  this.popsize = options.popsize || 50;
  this.elitism = options.elitism || 1;
  this.provenance = options.provenance || 0;
  this.mutationRate = options.mutationRate || 0.3;
  /* Number of changes per Gene */
  this.mutationAmount = options.mutationAmount || 1;

  this.fitnessPopulation = options.fitnessPopulation || false;

  this.selection = options.selection || Methods.selection.POWER;
  this.crossover = options.crossover || [
    Methods.crossover.SINGLE_POINT,
    Methods.crossover.TWO_POINT,
    Methods.crossover.UNIFORM,
    Methods.crossover.AVERAGE,
  ];
  this.mutation = options.mutation || Mutation.FFW; // was FFW

  this.template = options.network || false;

  this.maxNodes = options.maxNodes || Infinity;
  this.maxConns = options.maxConns || Infinity;
  this.maxGates = options.maxGates || Infinity;

  // Custom mutation selection function if given
  this.selectMutationMethod = typeof options.mutationSelection === "function"
    ? options.mutationSelection.bind(this)
    : this.selectMutationMethod;

  // Generation counter
  this.generation = 0;

  // Initialise the genomes
  this.createPool(this.template);
}

Neat.prototype = {
  /**
   * Create the initial pool of genomes
   */
  createPool: function (network) {
    this.population = [];

    for (let i = 0; i < this.popsize; i++) {
      let copy;
      if (this.template) {
        copy = Network.fromJSON(network.toJSON());
      } else {
        copy = new Network(this.input, this.output);
      }
      copy.score = undefined;
      this.population.push(copy);
    }
  },

  /**
   * Evaluates, selects, breeds and mutates population
   */
  evolve: async function () {
    // Check if evaluated, sort the population
    if (
      typeof this.population[this.population.length - 1].score === "undefined"
    ) {
      await this.evaluate();
    }

    // Elitism
    const elitists = makeElitists(this.population, this.elitism);
    const tmpFittest = elitists[0];

    const fittest = Network.fromJSON(tmpFittest.toJSON());
    fittest.score = tmpFittest.score;

    if (isFinite(fittest.score) == false) {
      for (let i = 0; i < this.population.length; i++) {
        console.warn(
          "this.population[" + i + "].score",
          this.population[i].score,
        );
        console.warn("this.population[" + i + "]", this.population[i].toJSON());
      }
      console.warn("fittest", fittest);
      throw "Infinite score";
    }
    const newPopulation = [];

    // Provenance
    for (let i = this.provenance; i--;) {
      const p = Network.fromJSON(this.template.toJSON());

      newPopulation.push(p);
    }

    // Breed the next individuals
    for (let i = 0; i < this.popsize - this.elitism - this.provenance; i++) {
      newPopulation.push(this.getOffspring());
    }

    // Replace the old population with the new population
    this._mutate(newPopulation);

    this.population = [...elitists, ...newPopulation]; // Keep pseudo sorted.

    // Reset the scores
    for (let i = this.population.length; i--;) {
      this.population[i].score = undefined;
    }

    this.generation++;

    return fittest;
  },

  /**
   * Breeds two parents into an offspring, population MUST be surted
   */
  getOffspring: function () {
    const parent1 = this.getParent();
    const parent2 = this.getParent();

    return Network.crossOver(parent1, parent2, this.equal);
  },

  /**
   * Selects a random mutation method for a genome according to the parameters
   */
  selectMutationMethod: function (genome) {
    const mutationMethod =
      this.mutation[Math.floor(Math.random() * this.mutation.length)];

    if (
      mutationMethod === Mutation.ADD_NODE &&
      genome.nodes.length >= this.maxNodes
    ) {
      if (Config.warnings) console.warn("maxNodes exceeded!");
      return;
    }

    if (
      mutationMethod === Mutation.ADD_CONN &&
      genome.connections.length >= this.maxConns
    ) {
      if (Config.warnings) console.warn("maxConns exceeded!");
      return;
    }

    if (
      mutationMethod === Mutation.ADD_GATE &&
      genome.gates.length >= this.maxGates
    ) {
      if (Config.warnings) console.warn("maxGates exceeded!");
      return;
    }

    return mutationMethod;
  },

  /**
   * Mutates the given (or current) population
   */
  _mutate: function (genes) {
    // const index = new Array(genes.length);
    // for (let i = genes.length; i--;) {
    //   index[i] = i;
    // }
    // shuffle(index);

    for (let i = genes.length; i--;) {
      // const pos = index[i];
      if (Math.random() <= this.mutationRate) {
        const gene=genes[i];
        for (let j = this.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(gene);
          gene.mutate(mutationMethod);
        }
      }
    }
  },

  /**
   * Evaluates the current population
   */
  evaluate: async function () {
    if (this.fitnessPopulation) {
      if (this.clear) {
        for (let i = 0; i < this.population.length; i++) {
          this.population[i].clear();
        }
      }
      try {
        await this.fitness(this.population);
      } catch (e) {
        console.error("fitness error", e);
        throw e;
      }
    } else {
      for (let i = 0; i < this.population.length; i++) {
        const genome = this.population[i];
        if (this.clear) genome.clear();
        genome.score = await this.fitness(genome);
      }
    }
  },

  /**
   * Sorts the population by score
   */
  sort: function () {
    this.population.sort(function (a, b) {
      return b.score - a.score;
    });
  },

  /**
   * Gets a genome based on the selection function
   * @return {Network} genome
   */
  getParent: function () {
    switch (this.selection) {
      case selection.POWER: {
        if (this.population[0].score < this.population[1].score) {
          console.trace();
          throw "Not Sorted";
        } //this.sort();

        const index = Math.floor(
          Math.pow(Math.random(), this.selection.power) *
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
          if (random < value) return genome;
        }

        // if all scores equal, return random genome
        return this
          .population[Math.floor(Math.random() * this.population.length)];
      }
      case selection.TOURNAMENT: {
        if (this.selection.size > this.popsize) {
          throw new Error(
            "Your tournament size should be lower than the population size, please change methods.selection.TOURNAMENT.size",
          );
        }

        // Create a tournament
        const individuals = new Array(this.selection.size);
        for (let i = 0; i < this.selection.size; i++) {
          const random =
            this.population[Math.floor(Math.random() * this.population.length)];
          individuals[i] = random;
        }

        // Sort the tournament individuals by score
        individuals.sort(function (a, b) {
          return b.score - a.score;
        });

        // Select an individual
        for (let i = 0; i < this.selection.size; i++) {
          if (
            Math.random() < this.selection.probability ||
            i === this.selection.size - 1
          ) {
            return individuals[i];
          }
        }
      }
    }
  },
};
