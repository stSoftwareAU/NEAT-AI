/* Import */

import { make as makeConfig } from "./config/NeatConfig.ts";

import { Fitness } from "./architecture/Fitness.ts";
import { NeatUtil } from "./NeatUtil.ts";

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

    // Initialize the genomes
    this.population = this.config.creatures;
  }
}
