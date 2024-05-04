import { blue } from "https://deno.land/std@0.224.0/fmt/colors.ts";
import { format } from "https://deno.land/std@0.224.0/fmt/duration.ts";
import { ensureDirSync } from "https://deno.land/std@0.224.0/fs/mod.ts";
import {
  addTag,
  getTag,
  removeTag,
} from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Creature } from "../Creature.ts";
import { NeatOptions } from "../config/NeatOptions.ts";
import { TrainOptions } from "../config/TrainOptions.ts";
import { Selection } from "../methods/Selection.ts";
import { Mutation } from "../methods/mutation.ts";
import {
  ResponseData,
  WorkerHandler,
} from "../multithreading/workers/WorkerHandler.ts";
import { CreatureInternal } from "../architecture/CreatureInterfaces.ts";
import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import {
  makeElitists,
  sortCreaturesByScore,
} from "../architecture/ElitismUtils.ts";
import { fineTuneImprovement } from "../architecture/FineTune.ts";
import { Fitness } from "../architecture/Fitness.ts";
import { Offspring } from "../architecture/Offspring.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { DeDuplicator } from "../architecture/DeDuplicator.ts";
import { NeatConfig } from "../config/NeatConfig.ts";
import { Genus } from "./Genus.ts";
import { Species } from "./Species.ts";

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

  /* Assuming weightedRandomSelect selects based on score, weighting higher scores more heavily.*/

  weightedRandomSelect(creatures: Creature[]) {
    const totalWeight = creatures.reduce(
      (sum, creature) => sum + 1 / (creatures.indexOf(creature) + 1),
      0,
    );
    let random = Math.random() * totalWeight;

    for (const creature of creatures) {
      random -= 1 / (creatures.indexOf(creature) + 1);
      if (random <= 0) {
        return creature;
      }
    }
    return creatures[0]; // Fallback to the first creature if no selection occurs
  }

  async makeFineTunePopulation(
    fittest: Creature,
    previousFittest: Creature | undefined,
    genus: Genus,
  ) {
    assert(fittest, "Fittest creature mandatory");
    const fittestUUID = await CreatureUtil.makeUUID(fittest);

    const uniqueUUID = new Set<string>([fittestUUID]);

    const tmpFineTunePopulation = [];

    // Add previousFittest first if it's different from fittest and not null
    if (
      previousFittest
    ) {
      const previousUUID = await CreatureUtil.makeUUID(previousFittest);
      if (!uniqueUUID.has(previousUUID)) {
        tmpFineTunePopulation.push(previousFittest);
        uniqueUUID.add(previousUUID);
      }
    }

    // Add remaining creatures from the population excluding fittest and previousFittest
    for (const creature of this.population) {
      const creatureUUID = await CreatureUtil.makeUUID(creature);
      if (!uniqueUUID.has(creatureUUID)) {
        tmpFineTunePopulation.push(creature);
        uniqueUUID.add(creatureUUID);
      }
    }

    const tmpPreviousFittest = tmpFineTunePopulation.shift();

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

      const tunedUUID = new Set<string>();

      tunedUUID.add(fittestUUID);

      tunedUUID.add(tmpPreviousFittest.uuid ?? "UNKNOWN");
      fineTunedPopulation = await fineTuneImprovement(
        fittest,
        tmpPreviousFittest,
        fineTunePopSize - 1,
        this.config.verbose,
      );

      for (let attempts = 0; attempts < 12; attempts++) {
        /**
         * Now, after we do the fine tuning of the fittest versus the previous fittest,
         * I want to find another creature from the same species of the fittest creature ( but not the fittest or previous fittest creatures)
         * and perform the fine tuning comparing the fittest creature to another within the species.
         *
         * We should favor the highest score creatures in that species.
         */

        const speciesFineTunePopSize = fineTunePopSize -
          fineTunedPopulation.length;

        if (speciesFineTunePopSize < 1) break;

        const speciesKey = await Species.calculateKey(fittest);
        const species = genus.speciesMap.get(speciesKey);

        if (species) {
          if (species.creatures.length > 1) { // Ensure there's more than one to choose from
            // const fittestUUID = fittest.uuid;
            // const previousFittestUUID = tmpPreviousFittest
            //   ? tmpPreviousFittest.uuid
            //   : null;

            // Filtering to exclude fittest and previous fittest, assuming creatures are already sorted
            const eligibleCreatures = species.creatures.filter((creature) =>
              !tunedUUID.has(creature.uuid ?? "UNKNOWN")
            );

            if (eligibleCreatures.length > 0) {
              // Introduce random selection, weighted towards higher score creatures
              const nextBestCreature = this.weightedRandomSelect(
                eligibleCreatures,
              );

              tunedUUID.add(nextBestCreature.uuid ?? "UNKNOWN");
              const extendedTunedPopulation = await fineTuneImprovement(
                fittest,
                nextBestCreature,
                speciesFineTunePopSize,
                false,
              );

              fineTunedPopulation.push(...extendedTunedPopulation);
            } else {
              console.warn(
                "No eligible creatures found for extended fine-tuning within the same species.",
              );
            }
          } //else {
          //console.warn(
          //  `TODO Insufficient creatures within the species for fine-tuning. ${species.creatures.length}`,
          //);
          //}
        } else {
          throw new Error(`No species found for key ${speciesKey}`);
        }

        const extendedFineTunePopSize = fineTunePopSize -
          fineTunedPopulation.length;
        if (extendedFineTunePopSize > 0 && tmpFineTunePopulation.length > 0) {
          /* Choose a creature from near the top of the list. */
          const location = Math.floor(
            tmpFineTunePopulation.length * Math.random() * Math.random(),
          );

          const extendedPreviousFittest = tmpFineTunePopulation[location];
          if (!extendedPreviousFittest) {
            throw new Error(
              `No creature found at location ${location} in tmpFineTunePopulation.`,
            );
          }
          tunedUUID.add(extendedPreviousFittest.uuid ?? "UNKNOWN");
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
  async evolve(
    previousFittest?: Creature,
  ): Promise<{ fittest: Creature; averageScore: number }> {
    await this.fitness.calculate(this.population);

    sortCreaturesByScore(this.population);

    const genus = new Genus();

    // The population is already sorted in the desired order
    for (let i = 0; i < this.population.length; i++) {
      const creature = this.population[i];
      await genus.addCreature(creature);
    }
    /* Elitism: we need at least 2 on the first run */
    const results = makeElitists(
      this.population,
      this.config.elitism > 1
        ? this.config.elitism
        : previousFittest
        ? this.config.elitism
        : 2,
      this.config.verbose,
    );
    const elitists = results.elitists;
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
        i < results.elitists.length;
        i++
      ) {
        const n = results.elitists[i];

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
      // elitists,
      genus,
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
      const child = this.offspring();
      if (child) {
        newPopulation.push(child);
      }
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

    const deDuplicator = new DeDuplicator(this);
    await deDuplicator.perform(this.population);

    return {
      fittest: fittest,
      averageScore: results.averageScore,
    };
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
        const sTxt = `${creature.score}`;

        Deno.writeTextFileSync(filePath, sTxt);
      }
    }
  }

  /**
   * Mutates the given (or current) population
   */
  mutate(creatures: Creature[]): void {
    for (let i = creatures.length; i--;) {
      if (Math.random() <= this.config.mutationRate) {
        const creature = creatures[i];
        if (this.config.debug) {
          creatureValidate(creature);
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
          creatureValidate(creature);
        }

        removeTag(creature, "approach");
      }
    }
  }

  /**
   * Create the initial pool of genomes
   */
  async populatePopulation(creature: Creature) {
    assert(creature, "Network mandatory");

    if (this.config.debug) {
      creatureValidate(creature);
    }
    while (this.population.length < this.config.populationSize - 1) {
      const clonedCreature = Creature.fromJSON(
        creature.internalJSON(),
        this.config.debug,
      );
      const creatures = [clonedCreature];
      this.mutate(creatures);
      this.population.push(creatures[0]);
    }

    this.population.unshift(creature);

    const deDuplicator = new DeDuplicator(this);
    await deDuplicator.perform(this.population);
  }

  /**
   * Breeds two parents into an offspring, population MUST be sorted
   */
  offspring(): Creature | undefined {
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
