import { blue } from "https://deno.land/std@0.215.0/fmt/colors.ts";
import { format } from "https://deno.land/std@0.215.0/fmt/duration.ts";
import { ensureDirSync } from "https://deno.land/std@0.215.0/fs/ensure_dir.ts";
import {
  addTag,
  getTag,
  removeTag,
} from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../Creature.ts";
import { NeatOptions } from "../config/NeatOptions.ts";
import { TrainOptions } from "../config/TrainOptions.ts";
import { Selection, SelectionInterface } from "../methods/Selection.ts";
import { Mutation, MutationInterface } from "../methods/mutation.ts";
import {
  ResponseData,
  WorkerHandler,
} from "../multithreading/workers/WorkerHandler.ts";
import { CreatureExport, CreatureInternal } from "./CreatureInterfaces.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { makeElitists } from "./ElitismUtils.ts";
import { fineTuneImprovement } from "./FineTune.ts";
import { Fitness } from "./Fitness.ts";
import { Offspring } from "./Offspring.ts";

class NeatConfig implements NeatOptions {
  /** List of creatures to start with */
  creatures: CreatureInternal[] | CreatureExport[];

  creativeThinkingConnectionCount: number;
  creatureStore?: string;
  experimentStore?: string;

  /** number of records per dataset file. default: 2000 */
  dataSetPartitionBreak?: number;
  disableRandomSamples?: boolean;
  /** debug (much slower) */
  debug: boolean;

  /**
   * Feedback loop ( previous result feeds back into next interaction
   * https://www.mathworks.com/help/deeplearning/ug/design-time-series-narx-feedback-neural-networks.html;jsessionid=2d7fa2c64f0bd39c86dec46870cd
   */
  feedbackLoop: boolean;

  /** The list of observations to focus one */
  focusList: number[];
  /** Focus rate */
  focusRate: number;

  elitism: number;

  /** Target error 0 to 1 */
  targetError: number;
  timeoutMinutes?: number;

  costOfGrowth: number;

  /** Tne maximum number of connections */
  maxConns: number;

  /** Tne maximum number of nodes */
  maximumNumberOfNodes: number;

  /** Number of changes per Gene */
  mutationAmount: number;

  /** Probability of changing a single gene */
  mutationRate: number;

  /** The target population size. */
  populationSize: number;

  costName: string;
  traceStore?: string;

  /** the number of training per generation. default: 1  */
  trainPerGen: number;

  selection: SelectionInterface;
  mutation: MutationInterface[];

  iterations: number;
  log: number;
  /** verbose logging default: false */
  verbose: boolean;
  trainingSampleRate?: number;

  constructor(options: NeatOptions) {
    this.creativeThinkingConnectionCount =
      options.creativeThinkingConnectionCount ?? 1;
    this.creatureStore = options.creatureStore;
    this.experimentStore = options.experimentStore;
    this.creatures = options.creatures ? options.creatures : [];
    this.costName = options.costName || "MSE";
    this.dataSetPartitionBreak = options.dataSetPartitionBreak;
    this.disableRandomSamples = options.disableRandomSamples;
    this.trainingSampleRate = options.trainingSampleRate;

    this.debug = options.debug
      ? true
      : ((globalThis as unknown) as { DEBUG: boolean }).DEBUG
      ? true
      : false;

    this.feedbackLoop = options.feedbackLoop || false;
    this.focusList = options.focusList || [];
    this.focusRate = options.focusRate || 0.25;

    this.targetError = options.targetError !== undefined
      ? Math.min(1, Math.max(Math.abs(options.targetError), 0))
      : 0.05;

    this.costOfGrowth = options.costOfGrowth !== undefined
      ? options.costOfGrowth
      : 0.000_1;

    this.iterations = options.iterations ? options.iterations : 0;

    this.populationSize = options.populationSize || 50;
    this.elitism = options.elitism || 1;

    this.maxConns = options.maxConns || Infinity;
    this.maximumNumberOfNodes = options.maximumNumberOfNodes || Infinity;
    this.mutationRate = options.mutationRate || 0.3;

    this.mutationAmount = options.mutationAmount
      ? options.mutationAmount > 1 ? options.mutationAmount : 1
      : 1;
    this.mutation = options.mutation || Mutation.FFW;
    this.selection = options.selection || Selection.POWER;

    this.timeoutMinutes = options.timeoutMinutes;
    this.traceStore = options.traceStore;
    this.trainPerGen = options.trainPerGen ? options.trainPerGen : 1;

    this.log = options.log ? options.log : 0;
    this.verbose = options.verbose ? true : false;

    if (this.mutationAmount < 1) {
      throw new Error(
        "Mutation Amount must be more than zero was: " +
          this.mutationAmount,
      );
    }

    if (this.mutationRate <= 0.001) {
      throw new Error(
        "Mutation Rate must be more than 0.1% was: " + this.mutationRate,
      );
    }
  }
}
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

    this.workers = workers ? workers : [];
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

  private trainingComplete: ResponseData[] = [];

  async scheduleTraining(
    creature: Creature,
    trainingTimeOutMinutes: number,
  ) {
    const uuid = await CreatureUtil.makeUUID(creature);
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

    const p = w.train(creature, trainOptions).then(async (r) => {
      this.trainingComplete.push(r);

      this.trainingInProgress.delete(uuid);

      if (this.config.traceStore && r.train) {
        if (r.train.trace) {
          const traceNetwork = Creature.fromJSON(
            JSON.parse(r.train.trace),
          );
          await CreatureUtil.makeUUID(traceNetwork);
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

  async checkAndAdd(
    fineTunePopulation: Creature[],
    tunedUUID: Set<string>,
    score: number,
    network?: Creature,
  ) {
    if (network) {
      const previousScoreTxt = getTag(network, "score");
      if (previousScoreTxt) {
        const previousScore = parseFloat(previousScoreTxt);
        if (previousScore < score) {
          const uuid = await CreatureUtil.makeUUID(network);
          if (!tunedUUID.has(uuid)) {
            tunedUUID.add(uuid);
            fineTunePopulation.push(network);
          }
        }
      }
    }
  }

  async makeFineTunePopulation(
    fittest: Creature,
    previousFittest: Creature | undefined,
    elitists: Creature[],
  ) {
    const tmpFineTunePopulation: Creature[] = [];
    const tunedUUID = new Set<string>();

    tunedUUID.add(await CreatureUtil.makeUUID(fittest));

    const score = fittest.score ? fittest.score : 0;
    await this.checkAndAdd(
      tmpFineTunePopulation,
      tunedUUID,
      score,
      previousFittest,
    );

    for (let i = 0; i < elitists.length; i++) {
      const network = elitists[i];
      await this.checkAndAdd(tmpFineTunePopulation, tunedUUID, score, network);
    }

    for (let i = 0; i < this.population.length; i++) {
      const network = this.population[i];
      await this.checkAndAdd(tmpFineTunePopulation, tunedUUID, score, network);
    }

    const tmpPreviousFittest = tmpFineTunePopulation.shift();

    /**
     * If this is the first run then use the second best as the "previous"
     *
     * If the previous fittest and current fittest are the same then try another out of the list of the elitists.
     */
    const rebootedFineTune = (previousFittest && tmpPreviousFittest)
      ? previousFittest.uuid != tmpPreviousFittest.uuid
      : false;

    let fineTunedPopulation: Creature[] = [];
    if (!tmpPreviousFittest) {
      console.warn("Failed to find previous fittest creature");
    } else {
      /** 20% of population or those that just died, leave one for the extended */
      const fineTunePopSize = Math.max(
        Math.ceil(
          this.config.populationSize / 5,
        ),
        this.config.populationSize - this.population.length -
          this.config.elitism -
          this.trainingComplete.length,
      );
      fineTunedPopulation = await fineTuneImprovement(
        fittest,
        tmpPreviousFittest,
        fineTunePopSize - 1,
        !rebootedFineTune && this.config.verbose,
      );

      for (let attempts = 0; attempts < 12; attempts++) {
        const extendedFineTunePopSize = fineTunePopSize -
          fineTunedPopulation.length;
        if (extendedFineTunePopSize > 0) {
          /* Choose a creature from near the top of the list. */
          const location = Math.floor(
            tmpFineTunePopulation.length * Math.random() * Math.random(),
          );

          const extendedPreviousFittest = tmpFineTunePopulation[location];

          const extendedTunedPopulation = await fineTuneImprovement(
            fittest,
            extendedPreviousFittest,
            extendedFineTunePopSize,
            false,
          );

          fineTunedPopulation.push(...extendedTunedPopulation);

          /* Remove the chosen creature from the array */
          tmpFineTunePopulation.splice(location, 1);
        } else {
          break;
        }
      }
    }

    return fineTunedPopulation;
  }

  /**
   * Evaluates, selects, breeds and mutates population
   */
  async evolve(previousFittest?: Creature) {
    await this.fitness.calculate(this.population);

    /* Elitism: we need at least 2 on the first run */
    const elitists = makeElitists(
      this.population,
      this.config.elitism > 1
        ? this.config.elitism
        : previousFittest
        ? this.config.elitism
        : 2,
      this.config.verbose,
    );
    const tmpFittest = elitists[0];

    const fittest = Creature.fromJSON(
      tmpFittest.exportJSON(),
      this.config.debug,
    ); // Make a copy so it's not mutated.
    fittest.score = tmpFittest.score;
    if (fittest.score != undefined) {
      addTag(fittest, "score", fittest.score.toString());
    }
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
        i < elitists.length;
        i++
      ) {
        const n = elitists[i];

        if (
          this.doNotStartMoreTraining == false &&
          this.trainingInProgress.size < this.config.trainPerGen &&
          Number.isFinite(n.score)
        ) {
          await this.scheduleTraining(n, trainingTimeOutMinutes);
        }
      }
    }

    const newPopulation = [];
    if (
      elitists.length > 0
    ) {
      const n = elitists[0];
      const creativeThinking = Creature.fromJSON(n.exportJSON());
      const weightScale = 1 / creativeThinking.synapses.length;
      for (let i = 0; i < this.config.creativeThinkingConnectionCount; i++) {
        creativeThinking.addConnection(
          Math.random() < this.config.focusRate
            ? this.config.focusList
            : undefined,
          {
            weightScale: weightScale,
          },
        );
      }

      newPopulation.push(creativeThinking);
    }

    const livePopulation = [];

    await this.writeScores(
      this.population,
    );

    for (let i = 0; i < this.population.length; i++) {
      const p = this.population[i];

      if (p.score && Number.isFinite(p.score)) {
        const oldScore = getTag(p, "old-score");
        if (oldScore && p.score <= parseFloat(oldScore)) {
          /** If fine tuning made no improvement then remove to prevent flooding of the population with clones. */
          continue;
        }

        livePopulation.push(p);
      }
    }

    if (livePopulation.length > 0) {
      this.population = livePopulation;
    } else {
      console.warn("All creatures died, using zombies");
    }

    const fineTunedPopulation = await this.makeFineTunePopulation(
      fittest,
      previousFittest,
      elitists,
    );

    const newPopSize = this.config.populationSize -
      elitists.length -
      this.trainingComplete.length -
      fineTunedPopulation.length - 1 -
      newPopulation.length;

    // Breed the next individuals
    for (
      let i = newPopSize > 0 ? newPopSize : 0;
      i--;
    ) {
      newPopulation.push(this.offspring());
    }

    // Replace the old population with the new population
    this.mutate(newPopulation);

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

          addTag(json, "approach", "trained");
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

            addTag(compactJSON, "approach", "compacted");
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

  async writeScores(creatures: Creature[]) {
    if (this.config.experimentStore) {
      for (let i = creatures.length; i--;) {
        const creature = creatures[i];

        const name = await CreatureUtil.makeUUID(creature);
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
  mutate(creatures: Creature[]) {
    for (let i = creatures.length; i--;) {
      if (Math.random() <= this.config.mutationRate) {
        const creature = creatures[i];
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
  async populatePopulation(network: Creature) {
    if (!network) {
      throw new Error(`Network mandatory`);
    }

    if (this.config.debug) {
      network.validate();
    }
    while (this.population.length < this.config.populationSize - 1) {
      const clonedCreature = Creature.fromJSON(
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
  offspring(): Creature {
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
        if (this.population[pos]) return this.population[pos];
      }
      throw new Error(`Extinction event`);
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
        if (this.population[pos]) return this.population[pos];
      }

      throw new Error(`Extinction event`);
    }

    const creature = Offspring.bread(
      p1,
      p2,
    );
    if (this.config.debug) creature.validate();
    return creature;
  }

  async deDuplicate(creatures: Creature[]) {
    if (creatures.length > this.config.populationSize + 1) {
      console.info(
        `Over populated ${creatures.length} expected ${this.config.populationSize}`,
      );
    }

    const unique = new Set();
    /**
     *  Reset the scores & de-duplicate the population.
     */
    for (let i = 0; i < creatures.length; i++) {
      const p = creatures[i];
      const key = await CreatureUtil.makeUUID(p);

      let duplicate = unique.has(key);
      if (!duplicate && i > this.config.elitism) {
        duplicate = this.previousExperiment(key);
      }
      if (duplicate) {
        if (creatures.length > this.config.populationSize) {
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
            const key2 = await CreatureUtil.makeUUID(p2);

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
  selectMutationMethod(creature: CreatureInternal) {
    const mutationMethods = this.config
      .mutation;

    for (let attempts = 0; true; attempts++) {
      const mutationMethod = mutationMethods[
        Math.floor(Math.random() * this.config.mutation.length)
      ];

      if (
        mutationMethod === Mutation.ADD_NODE &&
        creature.neurons.length >= this.config.maximumNumberOfNodes
      ) {
        continue;
      }

      if (
        mutationMethod === Mutation.ADD_CONN &&
        creature.synapses.length >= this.config.maxConns
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
