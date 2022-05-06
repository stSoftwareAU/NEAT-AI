/* Import */
import { Network } from "./architecture/network.js";
import { fineTuneImprovement } from "./architecture/FineTune.ts";
import { Methods } from "./methods/methods.js";
import { Mutation } from "./methods/mutation.ts";
import { make as makeConfig } from "./config/NeatConfig.ts";
import { makeElitists } from "../src/architecture/elitism.ts";
import { addTag, getTag } from "../src/tags/TagsInterface.ts";
import { Fitness } from "./architecture/Fitness.ts";
import { emptyDirSync } from "https://deno.land/std@0.137.0/fs/empty_dir.ts";
import { NeatUtil } from "./NeatUtil.ts";

/* Easier variable naming */
const selection = Methods.selection;

/*******************************************************************************
                                         NEAT
*******************************************************************************/
export class Neat {
  constructor(input, output, options, workers) {
    this.input = input; // The input size of the networks
    this.output = output; // The output size of the networks

    this.workers = workers;
    this.config = makeConfig(options);
    this.util = new NeatUtil(this, this.config);

    // The fitness function to evaluate the networks
    this.fitness = new Fitness(workers, this.config.growth);
    // Generation counter
    this.generation = 0;
    this.trainRate = this.config.trainRate;

    // Initialise the genomes
    this.population = this.config.creatures;
  }

  /**
   * Create the initial pool of genomes
   */
  async populatePopulation(network) {
    while (this.population.length < this.config.popsize) {
      let copy;
      if (network) {
        copy = Network.fromJSON(network.toJSON());
      } else {
        copy = new Network(this.input, this.output);
      }

      this.population.push(copy);
    }

    if (network) {
      this.population.unshift(network);
    }

    await this.deDepulate();
  }

  async deDepulate() {
    const unique = new Set();
    /**
     *  Reset the scores & de-duplcate the population.
     */
    for (let i = 0; i < this.population.length; i++) {
      const p = this.population[i];
      const key = await this.util.makeUniqueName(p);

      let duplicate = unique.has(key);
      if (!duplicate && i > this.config.elitism) {
        duplicate = this.util.previousExperiment(p);
      }
      if (duplicate) {
        for (let j = 0; j < 100; j++) {
          const tmpPopulation = [this.getOffspring()];
          this.util.mutate(tmpPopulation);

          const p2 = tmpPopulation[0];
          const key2 = await this.util.makeUniqueName(p2);

          let duplicate2 = unique.has(key2);
          if (!duplicate2 && i > this.config.elitism) {
            duplicate2 = this.util.previousExperiment(p2);
          }
          if (duplicate2 == false) {
            this.population[i] = p2;
            unique.add(key2);
            break;
          }
        }
      } else {
        unique.add(key);
      }
    }
  }

  /**
   * Evaluates, selects, breeds and mutates population
   */
  async evolve(previousFittest) {
    const trainPromises = [];
    for (let i = 0; i < this.population.length; i++) {
      const n = this.population[i];
      if (n.score) {
        if (this.workers.length > i) {
          const w = i % this.workers.length;
          // console.log("Worker: ", w);
          const p = this.workers[w].train(n, this.trainRate);
          trainPromises.push(p);
        }
      }
    }
    await this.evaluate();

    /* Elitism: we need at least 2 on the first run */
    const elitists = makeElitists(
      this.population,
      this.config.elitism > 1
        ? this.config.elitism
        : previousFittest
        ? this.config.elitism
        : 2,
    );
    const tmpFittest = elitists[0];

    const fittest = Network.fromJSON(tmpFittest.toJSON()); // Make a copy so it's not mutated.
    fittest.score = tmpFittest.score;
    addTag(fittest, "score", fittest.score.toString());
    addTag(fittest, "error", getTag(fittest, "error"));

    const livePopulation = [];

    await this.util.writeScores(
      this.population,
    );

    let trainingWorked = false;
    // let crippledCount = 0;
    for (let i = 0; i < this.population.length; i++) {
      const p = this.population[i];

      if (isFinite(p.score)) {
        const oldScore = getTag(p, "old-score");
        if (oldScore && p.score <= parseFloat(oldScore)) {
          /** If fine tuning made no improvement then remove to prevent flooding of the population with clones. */
          continue;
        }

        livePopulation.push(p);

        const untrained = getTag(p, "untrained");

        if (untrained) {
          const error = getTag(p, "error");
          const currentError = parseFloat(error) * -1;
          const previousError = parseFloat(untrained) * -1;

          if (currentError <= previousError) {
            // console.info( "Training worked", previousError, currentError );
            trainingWorked = true;
          }
        }
      }
    }

    if (previousFittest) {
      if (trainingWorked) {
        const nextRate = Math.min(this.trainRate * (1 + Math.random()), 0.1);
        // console.info( "trainRate increased", this.trainRate, nextRate, "by", nextRate - this.trainRate);
        this.trainRate = nextRate;
      } else {
        const nextRate = Math.max(this.trainRate * Math.random(), 0.000_000_01);
        this.trainRate = nextRate;
      }
    }

    this.population = livePopulation;

    /**
     * If this is the first run then use the second best as the "previous"
     *
     * If the previous fittest and current fittest are the same then try another out of the list of the elitists.
     */
    let rebootedFineTune = false;
    let tmpPreviousFittest = previousFittest;

    if (!tmpPreviousFittest) {
      tmpPreviousFittest = elitists[1];
    } else if (elitists.length > 1) {
      const previousScoreTxt = getTag(tmpPreviousFittest, "score");
      if (previousScoreTxt) {
        const previousScore = parseFloat(previousScoreTxt);
        if (previousScore == fittest.score) {
          const pos = Math.floor(Math.random() * elitists.length) + 1;
          tmpPreviousFittest = elitists[pos];

          if (tmpPreviousFittest) {
            const previousScoreTxt2 = getTag(tmpPreviousFittest, "score");
            if (!previousScoreTxt2) {
              console.info("No score for elitist", pos);
            } else {
              const previousScore2 = parseFloat(previousScoreTxt2);
              if (previousScore2 < fittest.score) {
                console.info(
                  "Rebooting fine tuning, elitist:",
                  pos,
                );
                rebootedFineTune = true;
              } else {
                console.info(
                  "FAILED: Rebooting fine tuning: previous score not less than current",
                  pos,
                  previousScore2,
                  fittest.score,
                );
              }
            }
          } else {
            console.info("FAILED Rebooting fine tuning: no creature at", pos);
          }
        }
      }
    }

    const fineTunedPopulation = fineTuneImprovement(
      fittest,
      tmpPreviousFittest,
      /** 20% of population or those that just died */
      Math.max(
        Math.ceil(this.config.popsize / 5),
        this.config.popsize - this.population.length,
      ),
      !rebootedFineTune,
    );

    const newPopulation = [];

    // Breed the next individuals
    for (
      let i = this.config.popsize - elitists.length -
        fineTunedPopulation.length;
      i--;
    ) {
      newPopulation.push(this.getOffspring());
    }

    // Replace the old population with the new population
    this.util.mutate(newPopulation);

    const trainPopulation = [];
    let tCounter = 0;
    emptyDirSync(".debug");
    await Promise.all(trainPromises).then((results) => {
      results.forEach((r) => {
        if (r.train) {
          if (isFinite(r.train.error)) {
            const json = JSON.parse(r.train.network);

            addTag(json, "approach", "trained");
            addTag(json, "error", r.train.error);
            addTag(json, "duration", r.duration);
            Deno.writeTextFileSync(
              ".debug/train-" + tCounter + ".json",
              JSON.stringify(json, null, 2),
            );

            const tmpElite = elitists[tCounter];
            if (tmpElite) {
              Deno.writeTextFileSync(
                ".debug/elitist-" + tCounter + ".json",
                JSON.stringify(elitists[tCounter].toJSON(), null, 2),
              );
            }
            tCounter++;
            trainPopulation.push(Network.fromJSON(json));
          }
        } else {
          throw "No train result";
        }
      });
    });

    this.population = [
      ...elitists,
      ...fineTunedPopulation,
      ...newPopulation,
      ...trainPopulation,
    ]; // Keep pseudo sorted.

    await this.deDepulate();

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
   * Evaluates the current population
   */
  async evaluate() {
    if (this.config.clear) {
      for (let i = this.population.length; i--;) {
        this.population[i].clear();
      }
    }

    try {
      await this.fitness.calculate(this.population);
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
