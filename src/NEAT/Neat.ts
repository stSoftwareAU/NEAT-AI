import { assert } from "@std/assert";
import { blue } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { ensureDirSync } from "@std/fs";
import { addTag, getTag, removeTag } from "@stsoftware/tags";
import { Creature } from "../Creature.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { DeDuplicator } from "../architecture/DeDuplicator.ts";
import {
  makeElitists,
  sortCreaturesByScore,
} from "../architecture/ElitismUtils.ts";
import { Fitness } from "../architecture/Fitness.ts";
import { FindTunePopulation } from "../blackbox/FineTunePopulation.ts";
import { NeatConfig } from "../config/NeatConfig.ts";
import type { NeatOptions } from "../config/NeatOptions.ts";
import type { TrainOptions } from "../config/TrainOptions.ts";
import type {
  ResponseData,
  WorkerHandler,
} from "../multithreading/workers/WorkerHandler.ts";
import { AddConnection } from "../mutate/AddConnection.ts";
import { Breed } from "./Breed.ts";
import { Genus } from "./Genus.ts";
import type { Approach } from "./LogApproach.ts";
import { Mutator } from "./Mutator.ts";

/**
 * NEAT, or NeuroEvolution of Augmenting Topologies, is an algorithm developed by Kenneth O. Stanley for evolving artificial neural networks.
 * It's particularly known for its effectiveness in optimizing both the weights and structures of neural networks simultaneously.
 *
 * Encoding: NEAT represents each neural network as a genome, which includes a list of connection genes, each with an innovation number (a unique historical marker identifying when a gene first appeared),
 *           an input node, an output node, a weight, an enable bit, and possibly a bias term.
 *
 * Initialization: Populations start with simple networks containing no hidden nodes, just direct connections from inputs to outputs.
 *                 This allows the algorithm to begin learning the simplest structure necessary for the task.
 *
 * Speciation: To protect innovation, NEAT sorts genomes into species based on genetic similarity.
 *             Each genome is assigned to a species if it is sufficiently similar to at least one exemplar genome in the species.
 *             This similarity is typically measured using excess and disjoint genes and average weight differences.
 *
 * Reproduction: Within each species, genomes reproduce based on their fitness scores.
 *               Reproduction may involve crossover (where parts of two genomes are combined into a new genome) and mutation (which can alter connection weights, add new connections, or add new nodes).
 *
 * Mutation: NEAT has three types of mutations:
 *     - Weights mutation: This can involve perturbing the existing weights or assigning new random values.
 *     - Add connection: A new connection is added between previously unconnected nodes.
 *     - Add node: This mutation takes an existing connection and splits it into two connections via a new node.
 *                 This new node can develop its own connections over time.
 *
 * Crossover: When two genomes crossover, their genes are combined to produce a new genome. If genes match in terms of their innovation numbers,
 *            they are inherited randomly from one parent or the other. Disjoint and excess genes (those that do not match) are inherited from the fitter parent.
 *
 * Fitness evaluation: Each genome is decoded into a neural network, and the network is evaluated to determine its fitness in solving the given task.
 *
 * Selection and speciation adjustment: Over time, species with consistently poor performance may have their allowed reproduction rates decreased,
 *                                      while successful species may gain a larger proportion of the next generation’s population.
 */
export class Neat {
  readonly input: number;
  readonly output: number;
  readonly config: NeatConfig;
  readonly workers: WorkerHandler[];
  readonly fitness: Fitness;

  readonly endTimeTS: number;
  population: Creature[];

  constructor(
    input: number,
    output: number,
    options: NeatOptions,
    workers: WorkerHandler[],
  ) {
    this.input = input; // The input size of the networks
    this.output = output; // The output size of the networks
    this.workers = workers;
    this.config = new NeatConfig(options);

    // The fitness function to evaluate the networks
    this.fitness = new Fitness(
      this.workers,
      this.config.costOfGrowth,
      this.config.feedbackLoop,
    );

    // Initialize the genomes
    this.population = [];
    this.config.creatures.forEach((c) => {
      const n = Creature.fromJSON(c);
      this.population.push(n);
    });

    this.endTimeTS = options.timeoutMinutes
      ? Date.now() + Math.max(1, options.timeoutMinutes) * 60_000
      : 0;
  }

  private doNotStartMoreTraining = false;
  private trainingCompleteCount = 0;

  finishUp() {
    this.doNotStartMoreTraining = true;
    if (this.trainingInProgress.size > 0) {
      if (!this.trainingCompleteCount) this.trainingCompleteCount = 2;
      console.info("Waiting for training to complete");
      return false;
    }
    if (this.trainingCompleteCount > 0) {
      console.info(
        `Waiting for training clean up ${this.trainingCompleteCount}`,
      );
      this.trainingCompleteCount--;
      return false;
    }
    return true;
  }

  private trainingInProgress = new Map<string, Promise<void>>();

  trainingComplete: ResponseData[] = [];

  scheduleTraining(
    creature: Creature,
    trainingTimeOutMinutes: number,
  ) {
    const uuid = CreatureUtil.makeUUID(creature);
    if (this.trainingInProgress.has(uuid)) return;
    let w: WorkerHandler;

    w = this.workers[Math.floor(this.workers.length * Math.random())];

    if (w.isBusy()) {
      for (let i = this.workers.length; i--;) {
        const tmpWorker = this.workers[i];
        if (!tmpWorker.isBusy()) {
          w = tmpWorker;
          break;
        }
      }
    }

    if (this.config.verbose) {
      console.info(
        `Training ${
          blue(uuid.substring(Math.max(0, uuid.length - 8)))
        } scheduled`,
      );
    }

    const trainOptions: TrainOptions = {
      cost: this.config.costName,
      log: this.config.log,
      traceStore: this.config.traceStore,
      iterations: 1,
      targetError: this.config.targetError,
      trainingSampleRate: this.config.trainingSampleRate,
      disableRandomSamples: this.config.disableRandomSamples,
      trainingTimeOutMinutes: trainingTimeOutMinutes,
    };

    const p = w.train(creature, trainOptions).then((r) => {
      this.trainingComplete.push(r);

      this.trainingInProgress.delete(uuid);

      if (this.config.traceStore && r.train) {
        if (r.train.trace) {
          const traceNetwork = Creature.fromJSON(
            JSON.parse(r.train.trace),
          );
          CreatureUtil.makeUUID(traceNetwork);
          ensureDirSync(this.config.traceStore);
          Deno.writeTextFileSync(
            `${this.config.traceStore}/${traceNetwork.uuid}.json`,
            JSON.stringify(traceNetwork.traceJSON(), null, 2),
          );
        }
      }
    });

    this.trainingInProgress.set(uuid, p);
  }

  /**
   * Evaluates, selects, breeds and mutates population
   */
  async evolve(
    previousFittest?: Creature,
  ): Promise<{ fittest: Creature; averageScore: number }> {
    await this.fitness.calculate(this.population);

    sortCreaturesByScore(this.population);

    const genus = new Genus();

    this.writeScores(
      this.population,
    );

    // The population is already sorted in the desired order
    for (let indx = 0; indx < this.population.length; indx++) {
      const creature = this.population[indx];
      assert(creature.uuid, "UUID missing");
      if (creature.score && Number.isFinite(creature.score)) {
        genus.addCreature(creature);
      } else {
        console.warn(
          `Creature ${
            blue(creature.uuid)
          } has no score ${creature.score}, excluded from fine tune population`,
        );
        this.population.splice(indx, 1); // Remove from population
        indx--;
      }
    }
    if (this.population.length === 0) {
      console.warn("All creatures died, using zombies");
    }

    const numberOfElitists = this.config.elitism > 1
      ? this.config.elitism
      : previousFittest
      ? this.config.elitism
      : 2;

    /* Elitism: we need at least 2 on the first run */
    const results = makeElitists(
      this.population,
      numberOfElitists,
      this.config.verbose,
    );
    const elitists = results.elitists;

    let tmpFittest = elitists[0];

    assert(tmpFittest.uuid, "Fittest creature has no UUID");
    assert(tmpFittest.score, "No fittest creature score found");
    if (previousFittest) {
      assert(previousFittest.score, "No previous fittest creature score found");
      assert(previousFittest.uuid, "Previous fittest creature has no UUID");
      if (tmpFittest.score < previousFittest.score) {
        throw new Error(
          `Previous fittest ${previousFittest.score} has a higher score than fittest ${tmpFittest.score} , this should not happen`,
        );
      } else if (previousFittest.score == tmpFittest.score) {
        if (previousFittest.uuid !== tmpFittest.uuid) {
          console.info(
            `Fittest creature ${
              tmpFittest.uuid.substring(0, 8)
            } has the same score as previous fittest ${
              previousFittest.uuid.substring(0, 8)
            } reuse previous fittest.`,
          );
        }
        tmpFittest = previousFittest;
      }
    }

    const fittest = Creature.fromJSON(
      tmpFittest.exportJSON(),
      this.config.debug,
    ); // Make a copy so it's not mutated.
    fittest.uuid = tmpFittest.uuid;

    fittest.score = tmpFittest.score;
    assert(fittest.score, "No fittest score found");

    addTag(fittest, "score", fittest.score.toString());

    const error = getTag(fittest, "error");
    addTag(fittest, "error", error ? error : "-1");

    let trainingTimeOutMinutes = 0;
    if (this.endTimeTS) {
      const diff = this.endTimeTS - Date.now();
      trainingTimeOutMinutes = Math.round(diff / 60_000);

      if (trainingTimeOutMinutes < 1) {
        trainingTimeOutMinutes = -1;
      }
    }

    if (trainingTimeOutMinutes != -1) { // If not timed out already
      for (
        let i = 0;
        i < results.elitists.length;
        i++
      ) {
        const n = results.elitists[i];

        if (
          this.doNotStartMoreTraining == false &&
          this.trainingInProgress.size < this.config.trainPerGen &&
          Number.isFinite(n.score)
        ) {
          this.scheduleTraining(n, trainingTimeOutMinutes);
        }
      }
    }

    const newPopulation = [];
    if (
      elitists.length > 0
    ) {
      const n = elitists[0];
      const creativeThinking = Creature.fromJSON(n.exportJSON());
      delete creativeThinking.memetic;
      const weightScale = 1 / creativeThinking.synapses.length;
      const addConnection = new AddConnection(creativeThinking);
      for (let i = 0; i < this.config.creativeThinkingConnectionCount; i++) {
        addConnection.mutate(
          Math.random() < this.config.focusRate
            ? this.config.focusList
            : undefined,
          {
            weightScale: weightScale,
          },
        );
      }
      // CreatureUtil.makeUUID(creativeThinking);
      // genus.addCreature(creativeThinking);
      assert(!creativeThinking.memetic);
      newPopulation.push(creativeThinking);
    }

    const ftp = new FindTunePopulation(this);
    const fineTunedPopulation = ftp.make(
      fittest,
      previousFittest,
      genus,
    );

    const newPopSize = this.config.populationSize -
      elitists.length -
      this.trainingComplete.length -
      fineTunedPopulation.length - 1 -
      newPopulation.length;

    const breed = new Breed(genus, this.config);
    // Breed the next individuals
    for (
      let i = 0;
      i < newPopSize;
      i++
    ) {
      const child = breed.breed();
      if (child) {
        // CreatureUtil.makeUUID(child);
        assert(!child.memetic);
        // genus.addCreature(child);
        newPopulation.push(child);
      }
    }

    const mutator = new Mutator(this.config);
    // Replace the old population with the new population
    mutator.mutate(newPopulation);

    const trainedPopulation: Creature[] = [];

    for (let i = this.trainingComplete.length; i--;) {
      const r = this.trainingComplete[i];
      if (r.train) {
        if (Number.isFinite(r.train.error)) {
          const json = JSON.parse(r.train.network);
          if (this.config.verbose) {
            console.info(
              `Training ${blue(r.train.ID)} completed ${
                r.duration
                  ? "after " + format(r.duration, { ignoreZero: true })
                  : ""
              }`,
            );
          }

          addTag(json, "approach", "trained" as Approach);
          delete json.memetic;
          removeTag(json, "approach-logged");
          addTag(json, "trainID", r.train.ID);
          addTag(json, "trained", "YES");

          trainedPopulation.push(Creature.fromJSON(json, this.config.debug));

          const compactJSON = r.train.compact
            ? JSON.parse(r.train.compact)
            : undefined;

          if (compactJSON) {
            if (this.config.verbose) {
              console.info(
                `Training ${blue(r.train.ID)} compacted`,
              );
            }

            addTag(compactJSON, "approach", "compact" as Approach);
            delete compactJSON.memetic;
            removeTag(compactJSON, "approach-logged");
            addTag(compactJSON, "trainID", r.train.ID);
            addTag(compactJSON, "trained", "YES");

            trainedPopulation.push(
              Creature.fromJSON(compactJSON, this.config.debug),
            );
          }
        } else {
          console.warn(
            `Training ${blue(r.train.ID)} FAILED ${
              r.duration
                ? "after " + format(r.duration, { ignoreZero: true })
                : ""
            }`,
          );
        }
      } else {
        throw new Error(`No train result`);
      }
    }
    this.trainingComplete.length = 0;

    this.population = [
      ...elitists,
      ...trainedPopulation,
      ...fineTunedPopulation,
      ...newPopulation,
    ]; // Keep pseudo sorted.

    const deDuplicator = new DeDuplicator(breed, mutator);
    deDuplicator.perform(this.population);

    return {
      fittest: fittest,
      averageScore: results.averageScore,
    };
  }

  writeScores(creatures: Creature[]) {
    if (!this.config.experimentStore) {
      return;
    }

    const baseStorePath = this.config.experimentStore + "/score/";

    for (const creature of creatures) {
      const name = CreatureUtil.makeUUID(creature);
      const dirPath = baseStorePath + name.substring(0, 3);
      ensureDirSync(dirPath);

      const filePath = `${dirPath}/${name.substring(3)}.txt`;
      const scoreText = `${creature.score}`;

      Deno.writeTextFileSync(filePath, scoreText);
    }
  }

  /**
   * Create the initial pool of genomes
   */
  populatePopulation(creature: Creature) {
    if (this.config.debug) {
      creatureValidate(creature);
    }
    const mutator = new Mutator(this.config);
    while (this.population.length < this.config.populationSize - 1) {
      const clonedCreature = Creature.fromJSON(
        creature.internalJSON(),
        this.config.debug,
      );
      const creatures = [clonedCreature];
      mutator.mutate(creatures);
      this.population.push(creatures[0]);
    }

    this.population.unshift(creature);

    const genus = new Genus();

    // The population is already sorted in the desired order
    for (let i = 0; i < this.population.length; i++) {
      const creature = this.population[i];
      CreatureUtil.makeUUID(creature);
      genus.addCreature(creature);
    }

    const breed = new Breed(genus, this.config);
    const deDuplicator = new DeDuplicator(breed, mutator);
    deDuplicator.perform(this.population);
  }
}
