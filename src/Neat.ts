/* Import */

import { make as makeConfig } from "./config/NeatConfig.ts";

import { Fitness } from "./architecture/Fitness.ts";

import { NeatOptions } from "./config/NeatOptions.ts";
import { NeatConfig } from "./config/NeatConfig.ts";
import { WorkerHandler } from "./multithreading/workers/WorkerHandler.ts";
import { NetworkInternal } from "./architecture/NetworkInterfaces.ts";
import { addTag, getTag, removeTag } from "../src/tags/TagsInterface.ts";
import { fineTuneImprovement } from "./architecture/FineTune.ts";
import { makeElitists } from "../src/architecture/elitism.ts";
import { Network } from "./architecture/Network.ts";
import { ensureDirSync } from "https://deno.land/std@0.181.0/fs/ensure_dir.ts";
import { Mutation } from "./methods/mutation.ts";
import { Selection } from "./methods/Selection.ts";
import { Offspring } from "./architecture/Offspring.ts";
import { NetworkUtil } from "./architecture/NetworkUtils.ts";

export class Neat {
  readonly input: number;
  readonly output: number;
  readonly config: NeatConfig;
  readonly workers: WorkerHandler[];
  readonly fitness: Fitness;
  trainRate: number;
  population: Network[];

  constructor(
    input: number,
    output: number,
    options: NeatOptions,
    workers: WorkerHandler[],
  ) {
    this.input = input; // The input size of the networks
    this.output = output; // The output size of the networks

    this.workers = workers ? workers : [];
    this.config = makeConfig(options);

    // The fitness function to evaluate the networks
    this.fitness = new Fitness(
      this.workers,
      this.config.growth,
      this.config.feedbackLoop,
    );

    this.trainRate = this.config.trainRate;

    // Initialize the genomes
    this.population = [];
    this.config.creatures.forEach((c) => {
      const n = Network.fromJSON(c);
      this.population.push(n);
    });
  }

  /**
   * Evaluates, selects, breeds and mutates population
   */
  async evolve(previousFittest?: NetworkInternal) {
    const trainPromises = [];
    for (
      let i = 0;
      i < this.population.length;
      i++
    ) {
      const n = this.population[i];
      if (n.score) {
        const trained = getTag(n, "trained");
        if (trained !== "YES") {
          const w: WorkerHandler =
            this.workers[Math.floor(this.workers.length * Math.random())];
          const p = w.train(n);
          trainPromises.push(p);
          addTag(n, "trained", "YES");
        }
      }

      if (trainPromises.length >= this.config.trainPerGen) break;
    }
    await this.fitness.calculate(this.population);

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

    const fittest = Network.fromJSON(
      (tmpFittest as Network).internalJSON(),
      this.config.debug,
    ); // Make a copy so it's not mutated.
    fittest.score = tmpFittest.score;
    if (fittest.score != undefined) {
      addTag(fittest, "score", fittest.score.toString());
    }
    const error = getTag(fittest, "error");
    addTag(fittest, "error", error ? error : "-1");

    const livePopulation = [];

    await this.writeScores(
      this.population,
    );

    let trainingWorked = false;

    for (let i = 0; i < this.population.length; i++) {
      const p = this.population[i];

      if (p.score && Number.isFinite(p.score)) {
        const oldScore = getTag(p, "old-score");
        if (oldScore && p.score <= parseFloat(oldScore)) {
          /** If fine tuning made no improvement then remove to prevent flooding of the population with clones. */
          continue;
        }

        livePopulation.push(p);

        const untrained = getTag(p, "untrained");

        if (untrained) {
          const error = getTag(p, "error");
          const currentError = Math.abs(
            parseFloat(error ? error : Number.MAX_SAFE_INTEGER.toString()),
          );
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
        const nextRate = Math.min(
          this.trainRate * (1 + Math.random()),
          0.1,
        );

        this.trainRate = nextRate;
      } else {
        const nextRate = Math.max(
          this.trainRate * Math.random(),
          0.000_000_01,
        );
        this.trainRate = nextRate;
      }
    }

    if (livePopulation.length > 0) {
      this.population = livePopulation;
    } else {
      console.warn("All creatures died, using zombies");
    }

    /**
     * If this is the first run then use the second best as the "previous"
     *
     * If the previous fittest and current fittest are the same then try another out of the list of the elitists.
     */
    let rebootedFineTune = false;
    let tmpPreviousFittest = previousFittest;

    if (!tmpPreviousFittest) {
      tmpPreviousFittest = elitists[1] as NetworkInternal;
    } else if (elitists.length > 1) {
      const previousScoreTxt = getTag(tmpPreviousFittest, "score");
      if (previousScoreTxt) {
        const previousScore = parseFloat(previousScoreTxt);
        if (previousScore == fittest.score) {
          let pos = Math.floor(Math.random() * elitists.length);

          for (; pos < elitists.length; pos++) {
            tmpPreviousFittest = elitists[pos] as NetworkInternal;
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
        Math.ceil(this.config.popSize / 5),
        this.config.popSize - this.population.length -
          this.config.elitism -
          trainPromises.length,
      ),
      !rebootedFineTune && this.config.verbose,
    );

    const newPopulation = [];

    const newPopSize = this.config.popSize -
      elitists.length -
      trainPromises.length -
      fineTunedPopulation.length - 1;

    // Breed the next individuals
    for (
      let i = newPopSize > 0 ? newPopSize : 0;
      i--;
    ) {
      newPopulation.push(this.offspring());
    }

    // Replace the old population with the new population
    this.mutate(newPopulation);

    const trainPopulation: Network[] = [];

    await Promise.all(trainPromises).then(async (results) => {
      for (let i = results.length; i--;) {
        const r = results[i];
        if (r.train) {
          if (Number.isFinite(r.train.error)) {
            const json = JSON.parse(r.train.network);

            addTag(json, "approach", "trained");
            addTag(json, "error", Math.abs(r.train.error).toString());
            // addTag(json, "duration", r.duration);

            trainPopulation.push(Network.fromJSON(json, this.config.debug));
            if (this.config.traceStore) {
              if (r.train.trace) {
                // Deno.writeTextFileSync( ".hack.json", JSON.stringify( JSON.parse( r.train.trace), null, 2));
                const traceNetwork = Network.fromJSON(
                  JSON.parse(r.train.trace),
                );
                await NetworkUtil.makeUUID(traceNetwork);

                Deno.writeTextFileSync(
                  `${this.config.traceStore}/${traceNetwork.uuid}.json`,
                  JSON.stringify(traceNetwork.traceJSON(), null, 2),
                );
              }
            }
          }
        } else {
          throw "No train result";
        }
      }
    });

    this.population = [
      ...(elitists as Network[]),
      ...trainPopulation,
      ...fineTunedPopulation,
      ...newPopulation,
    ]; // Keep pseudo sorted.

    await this.deDuplicate(this.population);

    return fittest;
  }

  previousExperiment(key: string) {
    if (this.config.experimentStore) {
      const filePath = this.config.experimentStore + "/score/" +
        key.substring(0, 3) + "/" + key.substring(3) + ".txt";
      try {
        Deno.statSync(filePath);

        return true;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          // file or directory does not exist
          return false;
        } else {
          // unexpected error, maybe permissions, pass it along
          throw error;
        }
      }
    } else {
      return false;
    }
  }

  async writeScores(creatures: Network[]) {
    if (this.config.experimentStore) {
      for (let i = creatures.length; i--;) {
        const creature = creatures[i];

        const name = await NetworkUtil.makeUUID(creature);
        ensureDirSync(
          this.config.experimentStore + "/score/" +
            name.substring(0, 3),
        );
        const filePath = this.config.experimentStore + "/score/" +
          name.substring(0, 3) + "/" +
          name.substring(3) + ".txt";
        const sTxt = creature.score ? creature.score.toString() : "unknown";

        Deno.writeTextFileSync(filePath, sTxt);
      }
    }
  }

  /**
   * Mutates the given (or current) population
   */
  mutate(creatures: NetworkInternal[]) {
    for (let i = creatures.length; i--;) {
      if (Math.random() <= this.config.mutationRate) {
        const creature = creatures[i] as Network;
        if (this.config.debug) {
          creature.validate();
        }
        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(creature);

          creature.mutate(
            mutationMethod,
            Math.random() < this.config.focusRate
              ? this.config.focusList
              : undefined,
          );
        }

        if (this.config.debug) {
          creature.validate();
        }

        removeTag(creature, "approach");
      }
    }
  }

  /**
   * Create the initial pool of genomes
   */
  async populatePopulation(network: Network) {
    if (!network) {
      throw "Network mandatory";
    }

    if (this.config.debug) {
      network.validate();
    }
    while (this.population.length < this.config.popSize - 1) {
      const clonedCreature = Network.fromJSON(
        network.internalJSON(),
        this.config.debug,
      );
      const creatures = [clonedCreature];
      this.mutate(creatures);
      this.population.push(creatures[0]);
    }

    this.population.unshift(network);

    await this.deDuplicate(this.population);
  }

  /**
   * Breeds two parents into an offspring, population MUST be sorted
   */
  offspring(): Network {
    const p1 = this.getParent();

    if (p1 === undefined) {
      console.warn(
        "No parent 1 found",
        this.config.selection.name,
        this.population.length,
      );

      for (let pos = 0; pos < this.population.length; pos++) {
        console.info(pos, this.population[pos] ? true : false);
      }
      for (let pos = 0; pos < this.population.length; pos++) {
        if (this.population[pos]) return (this.population[pos] as Network);
      }
      throw "Extinction event";
    }

    let p2 = this.getParent();
    for (let i = 0; i < 12; i++) {
      p2 = this.getParent();
      if (p1 !== p2) break;
    }

    if (p2 === undefined) {
      console.warn(
        "No parent 2 found",
        this.config.selection.name,
        this.population.length,
      );

      for (let pos = 0; pos < this.population.length; pos++) {
        console.info(pos, this.population[pos] ? true : false);
      }
      for (let pos = 0; pos < this.population.length; pos++) {
        if (this.population[pos]) return (this.population[pos] as Network);
      }

      throw "Extinction event";
    }

    const creature = Offspring.bread(
      p1,
      p2,
    );
    if (this.config.debug) creature.validate();
    return creature;
  }

  async deDuplicate(creatures: Network[]) {
    if (creatures.length > this.config.popSize + 1) {
      console.info(
        `Over populated ${creatures.length} expected ${this.config.popSize}`,
      );
    }

    const unique = new Set();
    /**
     *  Reset the scores & de-duplicate the population.
     */
    for (let i = 0; i < creatures.length; i++) {
      const p = creatures[i];
      const key = await NetworkUtil.makeUUID(p);

      let duplicate = unique.has(key);
      if (!duplicate && i > this.config.elitism) {
        duplicate = this.previousExperiment(key);
      }
      if (duplicate) {
        if (creatures.length > this.config.popSize) {
          console.info(
            `Culling duplicate creature at ${i} of ${creatures.length}`,
          );
          creatures.splice(i, 1);
          i--;
        } else {
          for (let j = 0; j < 100; j++) {
            const tmpPopulation = [this.offspring()];
            this.mutate(tmpPopulation);

            const p2 = tmpPopulation[0];
            const key2 = await NetworkUtil.makeUUID(p2);

            let duplicate2 = unique.has(key2);
            if (!duplicate2 && i > this.config.elitism) {
              duplicate2 = this.previousExperiment(key2);
            }
            if (duplicate2 == false) {
              creatures[i] = p2;
              unique.add(key2);
              break;
            }
          }
        }
      } else {
        unique.add(key);
      }
    }
  }

  /**
   * Selects a random mutation method for a genome according to the parameters
   */
  selectMutationMethod(creature: NetworkInternal) {
    const mutationMethods = this.config
      .mutation;

    for (let attempts = 0; true; attempts++) {
      const mutationMethod = mutationMethods[
        Math.floor(Math.random() * this.config.mutation.length)
      ];

      if (
        mutationMethod === Mutation.ADD_NODE &&
        creature.nodes.length >= this.config.maxNodes
      ) {
        continue;
      }

      if (
        mutationMethod === Mutation.ADD_CONN &&
        creature.connections.length >= this.config.maxConns
      ) {
        continue;
      }

      return mutationMethod;
    }
  }

  /**
   * Gets a genome based on the selection function
   * @return {Network} genome
   */
  getParent(): Network {
    switch (this.config.selection) {
      case Selection.POWER: {
        const r = Math.random();
        const index = Math.floor(
          Math.pow(r, Selection.POWER.power) *
            this.population.length,
        );

        return this.population[index] as Network;
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
              return genome as Network;
            }
          }
        }

        // if all scores equal, return random genome
        return this
          .population[
            Math.floor(Math.random() * this.population.length)
          ] as Network;
      }
      case Selection.TOURNAMENT: {
        if (Selection.TOURNAMENT.size > this.config.popSize) {
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
        throw "No parent found in tournament";
      }
      default: {
        throw "Unknown selection: " + this.config.selection;
      }
    }
  }
}
