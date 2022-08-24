/* Import */
import { fineTuneImprovement } from "./architecture/FineTune.ts";
import { Methods } from "./methods/methods.js";
import { make as makeConfig } from "./config/NeatConfig.ts";
import { makeElitists } from "../src/architecture/elitism.ts";
import { addTag, getTag } from "../src/tags/TagsInterface.ts";
import { Fitness } from "./architecture/Fitness.ts";
import { NeatUtil } from "./NeatUtil.ts";

import { NetworkUtil } from "./architecture/NetworkUtil.ts";

/* Easier variable naming */
const selection = Methods.selection;

/*******************************************************************************
                                         NEAT
*******************************************************************************/
export class Neat {
  constructor(input, output, options, workers) {
    this.input = input; // The input size of the networks
    this.output = output; // The output size of the networks

    this.workers = workers ? workers : [];
    this.config = makeConfig(options);
    this.util = new NeatUtil(this, this.config);

    // The fitness function to evaluate the networks
    this.fitness = new Fitness(
      this.workers,
      this.config.growth,
      this.config.feedbackLoop,
    );
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
    await this.util.populatePopulation(network);
  }

  /**
   * Evaluates, selects, breeds and mutates population
   */
  async evolve(previousFittest) {
    const trainPromises = [];
    for (
      let i = 0;
      i < this.population.length && i < this.workers.length;
      i++
    ) {
      const n = this.population[i];
      if (n.score) {
        const p = this.workers[i].train(n, this.trainRate);
        trainPromises.push(p);
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

    const fittest = NetworkUtil.fromJSON(
      tmpFittest.toJSON(),
      this.config.debug,
    ); // Make a copy so it's not mutated.
    fittest.score = tmpFittest.score;
    addTag(fittest, "score", fittest.score.toString());
    addTag(fittest, "error", getTag(fittest, "error"));

    const livePopulation = [];

    await this.util.writeScores(
      this.population,
    );

    let trainingWorked = false;

    for (let i = 0; i < this.population.length; i++) {
      const p = this.population[i];

      if (Number.isFinite(p.score)) {
        const oldScore = getTag(p, "old-score");
        if (oldScore && p.score <= parseFloat(oldScore)) {
          /** If fine tuning made no improvement then remove to prevent flooding of the population with clones. */
          continue;
        }

        livePopulation.push(p);

        const untrained = getTag(p, "untrained");

        if (untrained) {
          const error = getTag(p, "error");
          const currentError = Math.abs(parseFloat(error));
          const previousError = Math.abs(parseFloat(untrained));

          if (currentError < previousError) {
            // console.info( "Training worked", previousError, currentError );
            trainingWorked = true;
          }
        }
      }
    }

    if (previousFittest) {
      if (trainingWorked) {
        const nextRate = Math.min(this.trainRate * (1 + Math.random()), 0.1);

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
          let pos = Math.floor(Math.random() * elitists.length);

          for (; pos < elitists.length; pos++) {
            tmpPreviousFittest = elitists[pos];
            if (!tmpPreviousFittest) continue;
            const previousScoreTxt3 = getTag(tmpPreviousFittest, "score");
            if (!previousScoreTxt3) continue;

            const previousScore3 = parseFloat(previousScoreTxt3);
            if (previousScore3 < fittest.score) break;
          }

          if (tmpPreviousFittest) {
            const previousScoreTxt2 = getTag(tmpPreviousFittest, "score");
            if (!previousScoreTxt2) {
              console.info("No score for elitist", pos);
            } else {
              const previousScore2 = parseFloat(previousScoreTxt2);
              if (previousScore2 < fittest.score) {
                if (this.config.verbose) {
                  console.info(
                    "Rebooting fine tuning, elitist:",
                    pos,
                  );
                }
                rebootedFineTune = true;
              } else if (this.config.verbose) {
                console.info(
                  "FAILED: Rebooting fine tuning: previous score not less than current",
                  pos,
                  previousScore2,
                  fittest.score,
                );
              }
            }
          } else {
            console.info(
              "FAILED Rebooting fine tuning: no creature at",
              pos,
              "of",
              elitists.length,
            );
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
      !rebootedFineTune && this.config.verbose,
    );

    const newPopulation = [];

    // Breed the next individuals
    for (
      let i = this.config.popsize - elitists.length -
        fineTunedPopulation.length;
      i--;
    ) {
      newPopulation.push(this.util.getOffspring());
    }

    // Replace the old population with the new population
    this.util.mutate(newPopulation);

    const trainPopulation = [];

    await Promise.all(trainPromises).then((results) => {
      results.forEach((r) => {
        if (r.train) {
          if (Number.isFinite(r.train.error)) {
            const json = JSON.parse(r.train.network);

            addTag(json, "approach", "trained");
            addTag(json, "error", Math.abs(r.train.error));
            addTag(json, "duration", r.duration);

            trainPopulation.push(NetworkUtil.fromJSON(json, this.config.debug));
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

    await this.util.deDepulate(this.population);
    this.generation++;

    return fittest;
  }

  /**
   * Evaluates the current population
   */
  async evaluate() {
    if (this.config.clear) {
      for (let i = this.population.length; i--;) {
        this.population[i].util.clear();
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
