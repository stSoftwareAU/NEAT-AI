import { yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { emptyDirSync } from "@std/fs";
import { addTag, getTag, removeTag, type TagInterface } from "@stsoftware/tags";
import { CreatureUtil, Mutation } from "../mod.ts";
import type { BackPropagationConfig } from "./architecture/BackPropagation.ts";
import type {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "./architecture/CreatureInterfaces.ts";
import {
  CreatureState,
  type NeuronStateInterface,
} from "./architecture/CreatureState.ts";
import { creatureValidate } from "./architecture/CreatureValidate.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "./architecture/DataSet.ts";
import { Neuron } from "./architecture/Neuron.ts";
import type {
  NeuronExport,
  NeuronInternal,
  NeuronTrace,
} from "./architecture/NeuronInterfaces.ts";
import { Synapse } from "./architecture/Synapse.ts";
import type {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "./architecture/SynapseInterfaces.ts";
import { dataFiles } from "./architecture/Training.ts";
import { removeHiddenNeuron } from "./compact/CompactUtils.ts";
import { NeatConfig } from "./config/NeatConfig.ts";
import type { NeatOptions } from "./config/NeatOptions.ts";
import type { CostInterface } from "./Costs.ts";
import { Activations } from "./methods/activations/Activations.ts";
import { IDENTITY } from "./methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "./methods/activations/types/LOGISTIC.ts";
import { WorkerHandler } from "./multithreading/workers/WorkerHandler.ts";
import { AddBackCon } from "./mutate/AddBackCon.ts";
import { AddConnection } from "./mutate/AddConnection.ts";
import { AddNeuron } from "./mutate/AddNeuron.ts";
import { AddSelfCon } from "./mutate/AddSelfCon.ts";
import { ModActivation } from "./mutate/ModActivation.ts";
import { ModBias } from "./mutate/ModBias.ts";
import { ModWeight } from "./mutate/ModWeight.ts";
import type { RadioactiveInterface } from "./mutate/RadioactiveInterface.ts";
import { SubBackCon } from "./mutate/SubBackCon.ts";
import { SubConnection } from "./mutate/SubConnection.ts";
import { SubNeuron } from "./mutate/SubNeuron.ts";
import { SubSelfCon } from "./mutate/SubSelfCon.ts";
import { SwapNodes } from "./mutate/SwapNodes.ts";
import type { Approach } from "./NEAT/LogApproach.ts";
import { Neat } from "./NEAT/Neat.ts";
import type { MemeticInterface } from "./blackbox/MemeticInterface.ts";

/**
 * Creature Class
 *
 * The Creature class represents an AI entity within the NEAT (NeuroEvolution of Augmenting Topologies) framework.
 * It encapsulates the neural network structure and its associated behaviors, including activation, mutation,
 * propagation, and evolution processes. This class is integral to the simulation and evolution of neural networks.
 */

export class Creature implements CreatureInternal {
  /**
   * The unique identifier of this creature.
   * @type {string | undefined}
   */
  uuid?: string;

  /**
   * The number of input neurons.
   * @type {number}
   */
  input: number;

  /**
   * The number of output neurons.
   * @type {number}
   */
  output: number;

  /**
   * The array of neurons within this creature.
   * @type {Neuron[]}
   */
  neurons: Neuron[];

  /**
   * Optional tags associated with the creature.
   * @type {TagInterface[] | undefined}
   */
  tags?: TagInterface[];

  /**
   * The score of the creature, used for evaluating fitness.
   * @type {number | undefined}
   */
  score?: number;

  /**
   * The array of synapses (connections) between neurons.
   * @type {Synapse[]}
   */
  synapses: Synapse[];

  /** Records the orgins of this creature. */
  memetic?: MemeticInterface;

  /**
   * The state of the creature, managing the internal state and activations.
   * @type {CreatureState}
   */
  readonly state: CreatureState = new CreatureState(this);

  private cacheTo = new Map<number, Synapse[]>();
  private cacheFrom = new Map<number, Synapse[]>();
  private cacheSelf = new Map<number, Synapse[]>();
  private cacheFocus: Map<number, boolean> = new Map();

  /**
   * Debug mode flag.
   * @type {boolean}
   */
  DEBUG: boolean = ((globalThis as unknown) as { DEBUG: boolean }).DEBUG;

  /**
   * Constructs a new Creature instance.
   *
   * @param {number} input - The number of input neurons.
   * @param {number} output - The number of output neurons.
   * @param {Object} [options] - Configuration options for initializing the creature.
   * @param {boolean} [options.lazyInitialization=false] - If true, the creature will not be initialized immediately.
   * @param {Object[]} [options.layers] - Optional layers configuration.
   */
  constructor(
    input: number,
    output: number,
    options: {
      lazyInitialization?: boolean;
      layers?: { squash?: string; count: number }[];
    } = {},
  ) {
    this.input = input;
    this.output = output;
    this.neurons = [];
    this.synapses = [];

    this.tags = undefined;
    this.score = undefined;

    if (!options.lazyInitialization) {
      this.initialize(options);

      if (this.DEBUG) {
        creatureValidate(this);
      }
    }
  }

  /**
   * Dispose of the creature and all held memory.
   */
  public dispose() {
    this.clearState();
    this.clearCache();
    this.synapses.length = 0;
    this.neurons.length = 0;
  }

  /**
   * Clear the cache of connections.
   *
   * @param {number} [from=-1] - The starting index of the cache to clear.
   * @param {number} [to=-1] - The ending index of the cache to clear.
   */
  public clearCache(from: number = -1, to: number = -1) {
    if (from == -1 || to == -1) {
      this.cacheTo.clear();
      this.cacheFrom.clear();
      this.cacheSelf.clear();
    } else {
      this.cacheTo.delete(to);
      this.cacheFrom.delete(from);
      this.cacheSelf.delete(from);
    }
    this.cacheFocus.clear();
  }

  private initialize(options: {
    layers?: { squash?: string; count: number }[];
  }) {
    let fixNeeded = false;
    // Create input neurons
    for (let i = this.input; i--;) {
      const type = "input";
      const neuron = new Neuron(`input-${this.input - i - 1}`, type, 0, this);
      neuron.index = this.neurons.length;
      this.neurons.push(neuron);
    }

    if (options.layers) {
      let lastStartIndx = 0;
      let lastEndIndx = this.neurons.length - 1;

      for (let i = 0; i < options.layers.length; i++) {
        const layer = options.layers[i];

        for (let j = 0; j < layer.count; j++) {
          let tmpSquash = layer.squash ? layer.squash : LOGISTIC.NAME;
          if (tmpSquash == "*") {
            tmpSquash = Activations
              .NAMES[Math.floor(Activations.NAMES.length * Math.random())];
            fixNeeded = true;
          }

          const neuron = new Neuron(
            crypto.randomUUID(),
            "hidden",
            undefined,
            this,
            tmpSquash,
          );
          neuron.index = this.neurons.length;
          this.neurons.push(neuron);
        }

        const tmpOutput = this.output;
        this.output = 0;

        for (let k = lastStartIndx; k <= lastEndIndx; k++) {
          for (let l = lastEndIndx + 1; l < this.neurons.length; l++) {
            this.connect(k, l, Synapse.randomWeight());
          }
        }
        this.output = tmpOutput;
        lastStartIndx = lastEndIndx + 1;
        lastEndIndx = this.neurons.length - 1;
      }

      // Create output neurons
      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        const neuron = new Neuron(
          `output-${indx}`,
          type,
          undefined,
          this,
          LOGISTIC.NAME,
        );
        neuron.index = this.neurons.length;
        this.neurons.push(neuron);
      }

      for (let k = lastStartIndx; k <= lastEndIndx; k++) {
        for (let l = lastEndIndx + 1; l < this.neurons.length; l++) {
          this.connect(k, l, Synapse.randomWeight());
        }
      }
    } else {
      // Create output neurons
      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        const neuron = new Neuron(
          `output-${indx}`,
          type,
          undefined,
          this,
          LOGISTIC.NAME,
        );
        neuron.index = this.neurons.length;
        this.neurons.push(neuron);
      }

      // Connect input neurons with output neurons directly
      for (let i = 0; i < this.input; i++) {
        for (let j = this.input; j < this.output + this.input; j++) {
          /** https://stats.stackexchange.com/a/248040/147931 */
          const weight = Math.random() * this.input *
            Math.sqrt(2 / this.input);
          this.connect(i, j, weight);
        }
      }
    }

    if (fixNeeded) {
      this.fix();
    }
  }

  /**
   * Clear the context of the creature.
   */
  clearState() {
    this.score = undefined;
    this.state.clear();
  }

  /**
   * Activates the creature and traces the activity.
   *
   * @param {number[]} input - The input values for the creature.
   * @param {boolean} [feedbackLoop=false] - Whether to use a feedback loop during activation.
   * @returns {number[]} The output values after activation.
   */
  activateAndTrace(input: number[], feedbackLoop: boolean = false): number[] {
    const output: number[] = new Array(this.output);

    this.state.makeActivation(input, feedbackLoop);

    const lastHiddenNode = this.neurons.length - this.output;

    // Activate hidden neurons
    for (let i = this.input; i < lastHiddenNode; i++) {
      this.neurons[i].activateAndTrace();
    }

    // Activate output neurons and store their values in the output array
    for (let outIndx = 0; outIndx < this.output; outIndx++) {
      output[outIndx] = this.neurons[lastHiddenNode + outIndx]
        .activateAndTrace();
    }

    return output;
  }

  /**
   * Activates the creature without calculating traces.
   *
   * @param {number[]} input - The input values for the creature.
   * @param {boolean} [feedbackLoop=false] - Whether to use a feedback loop during activation.
   * @returns {number[]} The output values after activation.
   */
  activate(input: number[], feedbackLoop: boolean = false): number[] {
    const output: number[] = new Array(this.output);

    this.state.makeActivation(input, feedbackLoop);

    const lastHiddenNode = this.neurons.length - this.output;

    // Activate hidden neurons
    for (let i = this.input; i < lastHiddenNode; i++) {
      this.neurons[i].activate();
    }

    // Activate output neurons and store their values in the output array
    for (let outIndx = 0; outIndx < this.output; outIndx++) {
      output[outIndx] = this.neurons[lastHiddenNode + outIndx].activate();
    }

    return output;
  }

  /**
   * Compact the creature by removing redundant neurons and connections.
   *
   * @returns {Creature | undefined} A new compacted creature or undefined if no compaction occurred.
   */
  compact(): Creature | undefined {
    const holdDebug = this.DEBUG;
    this.DEBUG = false;
    const json = this.exportJSON();
    this.DEBUG = holdDebug;
    const compactCreature = Creature.fromJSON(json);
    compactCreature.fix();

    let complete = false;
    for (let changes = 0; complete == false; changes++) {
      complete = true;
      for (
        let pos = compactCreature.input;
        pos < compactCreature.neurons.length - compactCreature.output;
        pos++
      ) {
        const fromList = compactCreature.outwardConnections(pos).filter(
          (c: SynapseInternal) => {
            return c.from !== c.to;
          },
        );

        if (fromList.length == 0) {
          removeHiddenNeuron(compactCreature, pos);
          complete = false;
        } else {
          const toList = compactCreature.inwardConnections(pos).filter(
            (c: SynapseInternal) => {
              return c.from !== c.to;
            },
          );
          if (toList.length == 1) {
            const fromList = compactCreature.outwardConnections(pos).filter(
              (c: SynapseInternal) => {
                return c.from !== c.to;
              },
            );
            if (fromList.length == 1) {
              const to = fromList[0].to;
              const from = toList[0].from;

              const fromSquash = compactCreature.neurons[from].squash;
              if (
                from > this.input &&
                fromSquash ==
                  compactCreature.neurons[pos].squash &&
                (fromSquash == IDENTITY.NAME || fromSquash == LOGISTIC.NAME)
              ) {
                if (compactCreature.getSynapse(from, to) == null) {
                  let weightA = fromList[0].weight * toList[0].weight;

                  const tmpFromBias = compactCreature.neurons[from].bias;
                  const tmpToBias = compactCreature.neurons[pos].bias;
                  let biasA = tmpFromBias * toList[0].weight + tmpToBias;

                  if (biasA === Number.POSITIVE_INFINITY) {
                    biasA = Number.MAX_SAFE_INTEGER;
                  } else if (biasA === Number.NEGATIVE_INFINITY) {
                    biasA = Number.MIN_SAFE_INTEGER;
                  } else if (isNaN(biasA)) {
                    biasA = 0;
                  }

                  compactCreature.neurons[from].bias = biasA;

                  removeHiddenNeuron(compactCreature, pos);
                  let adjustedTo = to;
                  if (adjustedTo > pos) {
                    adjustedTo--;
                  }

                  if (weightA === Number.POSITIVE_INFINITY) {
                    weightA = Number.MAX_SAFE_INTEGER;
                  } else if (weightA === Number.NEGATIVE_INFINITY) {
                    weightA = Number.MIN_SAFE_INTEGER;
                  } else if (isNaN(weightA)) {
                    weightA = 0;
                  }

                  compactCreature.connect(
                    from,
                    adjustedTo,
                    weightA,
                    fromList[0].type,
                  );

                  if (changes < 12) {
                    complete = false;
                  }
                  break;
                }
              }
            }
          }
        }
      }
    }

    const json2 = compactCreature.exportJSON();
    if (JSON.stringify(json) != JSON.stringify(json2)) {
      addTag(compactCreature, "approach", "compact" as Approach);
      removeTag(compactCreature, "approach-logged");
      addTag(compactCreature, "old-nodes", this.neurons.length.toString());
      addTag(
        compactCreature,
        "old-connections",
        this.synapses.length.toString(),
      );

      return compactCreature;
    } else {
      return undefined;
    }
  }

  /**
   * Validate the creature structure.
   */
  validate() {
    creatureValidate(this);
  }

  /**
   * Get a self-connection for the neuron at the given index.
   *
   * @param {number} indx - The index of the neuron.
   * @returns {SynapseInternal | null} The self-connection or null if not found.
   */
  selfConnection(indx: number): SynapseInternal | null {
    let results = this.cacheSelf.get(indx);
    if (results === undefined) {
      results = [];
      const tmpList = this.synapses;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];
        if (c.to === indx && c.from == indx) {
          results.push(c);
        }
      }

      this.cacheSelf.set(indx, results);
    }

    if (results.length > 0) {
      return results[0];
    } else {
      return null;
    }
  }

  /**
   * Get the inward connections (afferent) for the neuron at the given index.
   *
   * @param {number} toIndx - The index of the target neuron.
   * @returns {Synapse[]} The list of inward connections.
   */
  inwardConnections(toIndx: number): Synapse[] {
    let results = this.cacheTo.get(toIndx);
    if (results === undefined) {
      results = [];

      for (let i = this.synapses.length; i--;) {
        const c = this.synapses[i];

        if (c.to === toIndx) results.push(c);
      }

      this.cacheTo.set(toIndx, results);
    }
    return results;
  }

  /**
   * Get the outward connections (efferent) for the neuron at the given index.
   *
   * @param {number} fromIndx - The index of the source neuron.
   * @returns {Synapse[]} The list of outward connections.
   */
  outwardConnections(fromIndx: number): Synapse[] {
    let results = this.cacheFrom.get(fromIndx);
    if (results === undefined) {
      const startIndex = this.binarySearchForStartIndex(fromIndx);

      if (startIndex !== -1) {
        results = [];
        for (let i = startIndex; i < this.synapses.length; i++) {
          const tmp = this.synapses[i];
          if (tmp.from === fromIndx) {
            results.push(tmp);
          } else {
            break; // Since it's sorted, no need to continue once 'from' changes
          }
        }
      } else {
        results = []; // No connections found
      }

      this.cacheFrom.set(fromIndx, results);
    }
    return results;
  }

  private binarySearchForStartIndex(fromIndx: number): number {
    let low = 0;
    let high = this.synapses.length - 1;
    let result = -1; // Default to -1 if not found

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midValue = this.synapses[mid];

      if (midValue.from < fromIndx) {
        low = mid + 1;
      } else if (midValue.from > fromIndx) {
        high = mid - 1;
      } else {
        result = mid; // Found a matching 'from', but need the first occurrence
        high = mid - 1; // Look left to find the first match
      }
    }

    return result;
  }

  /**
   * Get a specific synapse between two neurons.
   *
   * @param {number} from - The index of the source neuron.
   * @param {number} to - The index of the target neuron.
   * @returns {Synapse | null} The synapse or null if not found.
   */
  getSynapse(from: number, to: number): Synapse | null {
    const outwardConnections = this.outwardConnections(from);

    for (let indx = outwardConnections.length; indx--;) {
      const c = outwardConnections[indx];
      if (c.to == to) {
        return c;
      } else if (c.to < to) {
        break;
      }
    }

    return null;
  }

  /**
   * Connect two neurons with a synapse.
   *
   * @param {number} from - The index of the source neuron.
   * @param {number} to - The index of the target neuron.
   * @param {number} weight - The weight of the synapse.
   * @param {string} [type] - The type of the synapse.
   * @returns {Synapse} The created synapse.
   */
  connect(
    from: number,
    to: number,
    weight: number,
    type?: "positive" | "negative" | "condition",
  ): Synapse {
    const connection = new Synapse(
      from,
      to,
      weight,
      type,
    );

    let location = -1;

    for (let indx = this.synapses.length; indx--;) {
      const c = this.synapses[indx];

      if (c.from < from) {
        location = indx + 1;
        break;
      } else if (c.from === from) {
        if (c.to < to) {
          location = indx + 1;
          break;
        } else if (c.to === to) {
          const fromNeuron = this.neurons[from];
          const fromID = fromNeuron ? fromNeuron.ID() : `[${from}]`;

          const toNeuron = this.neurons[to];
          const toID = toNeuron ? toNeuron.ID() : `[${to}]`;

          throw new Error(
            indx + ") already connected from: " + fromID +
              " to: " + toID,
          );
        } else {
          location = indx;
        }
      } else {
        location = indx;
      }
    }
    if (location !== -1 && location < this.synapses.length) {
      const left = this.synapses.slice(0, location);
      const right = this.synapses.slice(location);

      this.synapses = [...left, connection, ...right];
    } else {
      this.synapses.push(connection);
    }

    this.clearCache(from, to);

    return connection;
  }

  /**
   * Disconnect two neurons by removing the synapse between them.
   *
   * @param {number} from - The index of the source neuron.
   * @param {number} to - The index of the target neuron.
   */
  disconnect(from: number, to: number) {
    const connections = this.synapses;

    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.from === from && connection.to === to) {
        connections.splice(i, 1);
        this.clearCache(from, to);

        break;
      }
    }
  }

  /**
   * Apply learnings to the creature using back propagation.
   *
   * @param {BackPropagationConfig} config - The back propagation configuration.
   * @returns {boolean} True if the creature was changed, false otherwise.
   */
  applyLearnings(config: BackPropagationConfig): boolean {
    this.propagateUpdate(config);

    let changed = false;
    for (let i = this.neurons.length; i--;) {
      const n = this.neurons[i];
      if (n.type == "input") break;
      if (config.trainingMutationRate > Math.random()) {
        changed ||= n.applyLearnings();
      }
    }

    if (changed) {
      this.fix();
    }

    return changed;
  }

  /**
   * Propagate the expected values through the creature's network.
   *
   * @param {number[]} expected - The expected output values.
   * @param {BackPropagationConfig} config - The back propagation configuration.
   */
  propagate(expected: number[], config: BackPropagationConfig) {
    this.state.cacheAdjustedActivation.clear();
    const indices = Int32Array.from({ length: this.output }, (_, i) => i); // Create an array of indices

    if (!config.disableRandomSamples) {
      CreatureUtil.shuffle(indices);
    }

    const lastOutputIndx = this.neurons.length - this.output;
    for (let i = this.output; i--;) {
      const expectedIndex = indices[i];
      const nodeIndex = lastOutputIndx + expectedIndex;

      const n = this.neurons[nodeIndex];

      n.propagate(
        expected[expectedIndex],
        config,
      );
    }
  }

  /**
   * Update the propagated values in the creature's network.
   *
   * @param {BackPropagationConfig} config - The back propagation configuration.
   */
  propagateUpdate(config: BackPropagationConfig) {
    this.state.propagated = true;

    // @TODO randomize the order of the neurons
    for (let indx = this.neurons.length - 1; indx >= this.input; indx--) {
      const n = this.neurons[indx];
      n.propagateUpdate(config);
    }
  }

  /**
   * Evolve the creature to achieve a lower error on a dataset.
   *
   * @param {string} dataSetDir - The directory containing the dataset.
   * @param {NeatOptions} options - The NEAT configuration options.
   * @returns {Promise<{ error: number; score: number; time: number }>} The evolution result.
   */
  async evolveDir(
    dataSetDir: string,
    options: NeatOptions,
  ): Promise<{ error: number; score: number; time: number }> {
    const start = Date.now();

    const endTimeMS = options.timeoutMinutes
      ? start + Math.max(1, options.timeoutMinutes) * 60000
      : 0;

    const workers: WorkerHandler[] = [];
    const config = new NeatConfig(options);

    const threads = Math.round(
      Math.max(
        options.threads ? options.threads : navigator.hardwareConcurrency,
        1,
      ),
    );

    for (let i = threads; i--;) {
      workers.push(
        new WorkerHandler(dataSetDir, config.costName, threads == 1),
      );
    }

    // Initialize the NEAT instance
    const neat = new Neat(
      this.input,
      this.output,
      options,
      workers,
    );

    neat.populatePopulation(this);

    let error = Infinity;
    let bestScore = -Infinity;
    let bestCreature: Creature | undefined;

    let iterationStartMS = Date.now();
    let generation = 0;
    const targetError = options.targetError ?? 0;
    const iterations = options.iterations ?? Number.POSITIVE_INFINITY;

    while (true) {
      const result = await neat.evolve(
        bestCreature,
      );

      const fittest: Creature = result.fittest;
      const fittestScore = fittest.score ?? -Infinity;
      if (fittestScore > bestScore) {
        const errorTmp = getTag(fittest, "error");
        if (errorTmp) {
          error = Number.parseFloat(errorTmp);
        } else {
          throw new Error("No error: " + errorTmp);
        }

        bestScore = fittestScore;
        bestCreature = Creature.fromJSON(fittest.exportJSON());
        bestCreature.uuid = fittest.uuid;
        bestCreature.score = bestScore;
      } else if (fittestScore < bestScore) {
        throw new Error(
          `Fitness decreased over generations was: ${bestScore} now: ${fittest.score}`,
        );
      }
      const now = Date.now();
      const timedOut = endTimeMS ? now > endTimeMS : false;

      generation++;

      const completed = timedOut || error <= targetError ||
        generation >= iterations;

      if (
        options.log &&
        (generation % options.log === 0 || completed)
      ) {
        let avgTxt = "";
        if (Number.isFinite(result.averageScore)) {
          avgTxt = `(avg: ${yellow(result.averageScore.toFixed(4))})`;
        }
        console.log(
          "Generation",
          generation,
          "score",
          fittest.score,
          avgTxt,
          "error",
          error,
          (options.log > 1 ? "avg " : "") + "time",
          yellow(
            format(Math.round((now - iterationStartMS) / options.log), {
              ignoreZero: true,
            }),
          ),
        );

        iterationStartMS = now;
      }

      if (completed) {
        if (neat.finishUp()) {
          break;
        }
      }
    }

    for (let i = workers.length; i--;) {
      const w = workers[i];
      w.terminate();
    }
    workers.length = 0; // Release the memory.

    if (bestCreature) {
      this.loadFrom(bestCreature, options.debug ?? false);
    }

    if (options.creatureStore) {
      this.writeCreatures(neat, options.creatureStore);
    }

    return {
      error: error,
      score: bestScore,
      time: Date.now() - start,
    };
  }

  /**
   * Evolve the creature to achieve a lower error on a dataset.
   *
   * @param {DataRecordInterface[]} dataSet - The dataset for evolution.
   * @param {NeatOptions} options - The NEAT configuration options.
   * @returns {Promise<{ error: number; score: number; time: number }>} The evolution result.
   */
  async evolveDataSet(
    dataSet: DataRecordInterface[],
    options: NeatOptions,
  ): Promise<{ error: number; score: number; time: number }> {
    const dataSetDir = makeDataDir(dataSet, options.dataSetPartitionBreak);

    const result = await this.evolveDir(dataSetDir, options);

    Deno.removeSync(dataSetDir, { recursive: true });

    return result;
  }

  private evaluateData(
    json: { input: number[]; output: number[] }[],
    cost: CostInterface,
    feedbackLoop: boolean,
  ): { error: number; count: number } {
    let error = 0;
    const count = json.length;

    for (let i = count; i--;) {
      const data = json[i];
      const output = this.activate(data.input, feedbackLoop);
      error += cost.calculate(data.output, output);
    }

    return {
      error,
      count,
    };
  }

  /**
   * Evaluate a dataset and return the error.
   *
   * @param {string} dataDir - The directory containing the dataset.
   * @param {CostInterface} cost - The cost function to evaluate the error.
   * @param {boolean} feedbackLoop - Whether to use a feedback loop during evaluation.
   * @returns {{ error: number }} The evaluation result.
   */
  evaluateDir(
    dataDir: string,
    cost: CostInterface,
    feedbackLoop: boolean,
  ): { error: number } {
    const dataResult = dataFiles(dataDir);
    if (dataResult.binary.length) {
      let error = 0;
      let count = 0;

      const valuesCount = this.input + this.output;
      const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes
      const array = new Float32Array(valuesCount);
      const uint8Array = new Uint8Array(array.buffer);
      for (let i = dataResult.binary.length; i--;) {
        const filePath = dataResult.binary[i];

        const file = Deno.openSync(filePath, { read: true });
        try {
          while (true) {
            const bytesRead = file.readSync(uint8Array);
            if (bytesRead === null || bytesRead === 0) {
              break;
            }
            if (bytesRead !== BYTES_PER_RECORD) {
              throw new Error(
                `Invalid number of bytes read ${bytesRead} expected ${BYTES_PER_RECORD}`,
              );
            }
            const observations: number[] = Array.from(
              array.subarray(0, this.input),
            );
            const output = this.activate(observations, feedbackLoop);
            const expected: number[] = Array.from(array.subarray(this.input));
            error += cost.calculate(expected, output);
            count++;
          }
        } finally {
          file.close();
        }
      }
      return { error: error / count };
    } else {
      if (dataResult.json.length === 1) {
        const fn = dataResult.json[0];
        const json = JSON.parse(Deno.readTextFileSync(fn));

        const result = this.evaluateData(json, cost, feedbackLoop);
        return { error: result.error / result.count };
      } else {
        let totalCount = 0;
        let totalError = 0;
        for (let i = dataResult.json.length; i--;) {
          const json = JSON.parse(Deno.readTextFileSync(dataResult.json[i]));

          try {
            const result = this.evaluateData(json, cost, feedbackLoop);
            totalCount += result.count;
            totalError += result.error;
          } catch (e) {
            throw new Error(`Error in file: ${dataResult.json[i]}`, e);
          }
        }
        return { error: totalError / totalCount };
      }
    }
  }

  private writeCreatures(neat: Neat, dir: string) {
    let counter = 1;
    emptyDirSync(dir);
    neat.population.forEach((creature) => {
      const json = creature.exportJSON();

      const txt = JSON.stringify(json, null, 1);

      const filePath = dir + "/" + counter + ".json";
      Deno.writeTextFileSync(filePath, txt);

      counter++;
    });
  }

  /**
   * Check if a neuron is in focus.
   *
   * @param {number} index - The index of the neuron.
   * @param {number[]} [focusList] - The list of focus indices.
   * @param {Set<number>} [checked] - The set of checked indices.
   * @returns {boolean} True if the neuron is in focus, false otherwise.
   */
  public inFocus(
    index: number,
    focusList?: number[],
    checked: Set<number> = new Set(),
  ): boolean {
    if (!focusList || focusList.length == 0) {
      return true;
    }

    // Check the cache first if there is a focus list
    if (this.cacheFocus.has(index)) {
      return this.cacheFocus.get(index) as boolean;
    }

    if (checked.has(index)) {
      this.cacheFocus.set(index, false);
      return false;
    }

    checked.add(index);

    for (let pos = 0; pos < focusList.length; pos++) {
      const focusIndex = focusList[pos];

      if (index == focusIndex) {
        this.cacheFocus.set(index, true);
        return true;
      }

      const toList = this.inwardConnections(index);

      for (let i = toList.length; i--;) {
        const checkIndx: number = toList[i].from;
        if (checkIndx === index) {
          this.cacheFocus.set(index, true);
          return true;
        }

        if (this.inFocus(checkIndx, focusList, checked)) {
          this.cacheFocus.set(index, true);
          return true;
        }
      }
    }

    this.cacheFocus.set(index, false);
    return false;
  }

  /**
   * Create a random connection for the neuron at the given index.
   *
   * @param {number} indx - The index of the target neuron.
   * @returns {Synapse | null} The created synapse or null if no connection was made.
   */
  public makeRandomConnection(indx: number): Synapse | null {
    const toType = this.neurons[indx].type;
    if (toType == "constant" || toType == "input") {
      throw new Error(`Can't connect to ${toType}`);
    }
    for (let attempts = 0; attempts < 12; attempts++) {
      const from = Math.min(
        this.neurons.length - this.output - 1,
        Math.floor(Math.random() * indx + 1),
      );
      const c = this.getSynapse(from, indx);
      if (c === null) {
        return this.connect(
          from,
          indx,
          Synapse.randomWeight(),
        );
      }
    }
    const firstOutputIndex = this.neurons.length - this.output;
    for (let from = 0; from <= indx; from++) {
      if (from >= firstOutputIndex && from !== indx) continue;
      const c = this.getSynapse(from, indx);
      if (c === null) {
        return this.connect(
          from,
          indx,
          Synapse.randomWeight(),
        );
      }
    }
    return null;
  }

  /**
   * Mutate the creature using a specific method.
   *
   * @param {Object} method - The mutation method.
   * @param {string} method.name - The name of the mutation method.
   * @param {number[]} [focusList] - The list of focus indices.
   */
  mutate(method: { name: string }, focusList?: number[]): boolean {
    if (typeof method.name !== "string") {
      throw new Error("Mutate method wrong type: " + (typeof method));
    }

    let mutator: RadioactiveInterface | undefined;
    switch (method.name) {
      case Mutation.ADD_NODE.name:
        mutator = new AddNeuron(this);
        break;
      case Mutation.SUB_NODE.name:
        mutator = new SubNeuron(this);
        break;
      case Mutation.ADD_CONN.name:
        mutator = new AddConnection(this);
        break;
      case Mutation.SUB_CONN.name:
        mutator = new SubConnection(this);
        break;
      case Mutation.MOD_WEIGHT.name:
        mutator = new ModWeight(this);
        break;
      case Mutation.MOD_BIAS.name:
        mutator = new ModBias(this);
        break;
      case Mutation.MOD_ACTIVATION.name:
        mutator = new ModActivation(this);
        break;
      case Mutation.ADD_SELF_CONN.name:
        mutator = new AddSelfCon(this);
        break;
      case Mutation.SUB_SELF_CONN.name:
        mutator = new SubSelfCon(this);
        break;
      case Mutation.ADD_BACK_CONN.name:
        mutator = new AddBackCon(this);
        break;
      case Mutation.SUB_BACK_CONN.name:
        mutator = new SubBackCon(this);
        break;
      case Mutation.SWAP_NODES.name:
        mutator = new SwapNodes(this);
        break;
      default: {
        throw new Error("unknown: " + method);
      }
    }

    let changed = false;
    changed = mutator.mutate(focusList);

    if (!changed && (!focusList || focusList.length == 0)) {
      console.info(
        `${method.name} didn't mutate the creature. ${this.input} observations, ${
          this.neurons.length - this.input - this.output
        } neurons, ${this.output} outputs, ${this.synapses.length} synapses`,
      );
    }

    delete this.uuid;
    this.fix();
    if (this.DEBUG) {
      creatureValidate(this);
    }

    return changed;
  }

  /**
   * Fix the structure of the creature.
   */
  fix() {
    const holdDebug = this.DEBUG;
    this.DEBUG = false;
    const startTxt = JSON.stringify(this.internalJSON());
    this.DEBUG = holdDebug;
    const maxTo = this.neurons.length - 1;
    const minTo = this.input;

    const tmpSynapses: Synapse[] = [];
    this.synapses.forEach((synapse) => {
      if (synapse.to > maxTo) {
        console.debug("Ignoring connection to above max", maxTo, synapse);
      } else if (synapse.to < minTo) {
        console.debug("Ignoring connection to below min", minTo, synapse);
      } else if (synapse.weight && Number.isFinite(synapse.weight)) {
        /** Zero weight may as well be removed */
        tmpSynapses.push(synapse as Synapse);
      } else {
        if (this.neurons[synapse.to].type == "output") {
          /** Don't remove the last one for an output neuron */
          if (this.inwardConnections(synapse.to).length == 1) {
            tmpSynapses.push(synapse as Synapse);
          }
        }
      }
    });

    this.synapses = tmpSynapses;

    /* Make sure the synapses are sorted */
    this.synapses.sort((a, b) => {
      if (a.from === b.from) {
        return a.to - b.to;
      } else {
        return a.from - b.from;
      }
    });

    this.clearCache();

    let neuronRemoved = true;

    while (neuronRemoved) {
      neuronRemoved = false;
      for (
        let pos = this.input;
        pos < this.neurons.length - this.output;
        pos++
      ) {
        if (this.neurons[pos].type == "output") continue;
        if (
          this.outwardConnections(pos).filter((c) => {
            return c.from !== c.to;
          }).length == 0
        ) {
          removeHiddenNeuron(this, pos);
          neuronRemoved = true;
          break;
        }
      }
    }

    this.neurons.forEach((node) => {
      node.fix();
    });

    const endTxt = JSON.stringify(this.internalJSON());
    if (startTxt != endTxt) {
      delete this.uuid;
    }
  }

  /**
   * Get the output count of the creature.
   *
   * @returns {number} The number of output neurons.
   */
  outputCount(): number {
    return this.output;
  }

  /**
   * Get the node count of the creature.
   *
   * @returns {number} The number of neurons.
   */
  nodeCount(): number {
    return this.neurons.length;
  }

  /**
   * Convert the creature to a JSON object.
   *
   * @returns {CreatureExport} The JSON representation of the creature.
   */
  exportJSON(): CreatureExport {
    if (this.DEBUG) {
      creatureValidate(this);
    }

    const json: CreatureExport = {
      neurons: new Array<NeuronExport>(
        this.neurons.length - this.input,
      ),
      synapses: new Array<SynapseExport>(this.synapses.length),
      input: this.input,
      output: this.output,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    const uuidMap = new Map<number, string>();
    for (let i = this.neurons.length; i--;) {
      const neuron = this.neurons[i];
      uuidMap.set(i, neuron.uuid ?? `unknown-${i}`);
      if (neuron.type == "input") continue;

      const tojson = neuron.exportJSON();

      json.neurons[i - this.input] = tojson;
    }

    for (let i = this.synapses.length; i--;) {
      const exportJSON = this.synapses[i].exportJSON(
        uuidMap,
      );

      json.synapses[i] = exportJSON;
    }

    if (this.memetic) {
      json.memetic = JSON.parse(JSON.stringify(this.memetic));
    }

    return json;
  }

  /**
   * Convert the creature to a trace JSON object.
   *
   * @returns {CreatureTrace} The trace JSON representation of the creature.
   */
  traceJSON(): CreatureTrace {
    const json = this.exportJSON();

    const traceNeurons = Array<NeuronTrace>(json.neurons.length);
    let exportIndex = 0;
    this.neurons.forEach((n) => {
      if (n.type !== "input") {
        const indx = n.index;
        const ns = this.state.node(indx);

        const traceNeuron: NeuronExport = json
          .neurons[exportIndex] as NeuronTrace;

        if (n.type !== "constant") {
          (traceNeuron as NeuronTrace).trace = ns;
        }
        traceNeurons[exportIndex] = traceNeuron as NeuronTrace;
        exportIndex++;
      }
    });
    json.neurons = traceNeurons;
    const traceConnections = Array<SynapseTrace>(json.synapses.length);
    this.synapses.forEach((c, indx) => {
      const exportConnection = json.synapses[indx] as SynapseTrace;
      const cs = this.state.connection(c.from, c.to);
      exportConnection.trace = cs;

      traceConnections[indx] = exportConnection;
    });
    json.synapses = traceConnections;

    if (this.memetic) {
      json.memetic = JSON.parse(JSON.stringify(this.memetic));
    }

    return json as CreatureTrace;
  }

  /**
   * Convert the creature to an internal JSON object.
   *
   * @returns {CreatureInternal} The internal JSON representation of the creature.
   */
  internalJSON(): CreatureInternal {
    if (this.DEBUG) {
      creatureValidate(this);
    }

    const json: CreatureInternal = {
      uuid: this.uuid,
      neurons: new Array<NeuronInternal>(
        this.neurons.length - this.input,
      ),
      synapses: new Array<SynapseInternal>(this.synapses.length),
      input: this.input,
      output: this.output,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    for (let i = this.neurons.length; i--;) {
      const neuron = this.neurons[i];

      if (neuron.type == "input") continue;

      const tojson = neuron.internalJSON(i);

      json.neurons[i - this.input] = tojson;
    }

    for (let i = this.synapses.length; i--;) {
      const internalJSON = this.synapses[i].internalJSON();

      json.synapses[i] = internalJSON;
    }

    if (this.memetic) {
      json.memetic = JSON.parse(JSON.stringify(this.memetic));
    }

    return json;
  }

  /**
   * Load the creature from a JSON object.
   *
   * @param {CreatureInternal | CreatureExport} json - The JSON object representing the creature.
   * @param {boolean} validate - Whether to validate the creature after loading.
   */
  loadFrom(json: CreatureInternal | CreatureExport, validate: boolean) {
    this.uuid = (json as CreatureInternal).uuid;
    this.neurons.length = json.neurons.length;
    if (json.tags) {
      this.tags = [...json.tags];
    }

    this.clearState();

    const uuidMap = new Map<string, number>();
    this.neurons = new Array(this.neurons.length);
    for (let i = json.input; i--;) {
      const key = `input-${i}`;
      uuidMap.set(key, i);
      const n = new Neuron(key, "input", undefined, this);
      n.index = i;
      this.neurons[i] = n;
    }

    let pos = json.input;
    let outputIndx = 0;
    const neurons = json.neurons;
    for (let i = 0; i < neurons.length; i++) {
      const jn = neurons[i];

      if (jn.type === "input") continue;
      if (jn.type == "output") {
        jn.uuid = `output-${outputIndx}`;

        outputIndx++;
      }
      const n = Neuron.fromJSON(jn, this);
      n.index = pos;
      if ((jn as NeuronTrace).trace) {
        const trace: NeuronStateInterface = (jn as NeuronTrace).trace;
        const ns = this.state.node(n.index);
        Object.assign(ns, trace);
      }

      uuidMap.set(n.uuid, pos);

      this.neurons[pos] = n;
      pos++;
    }

    this.synapses.length = 0;
    const cLen = json.synapses.length;
    const synapses = json.synapses;
    for (let i = 0; i < cLen; i++) {
      const synapse = synapses[i];
      const se = synapse as SynapseExport;
      let from = se.fromUUID
        ? uuidMap.get(se.fromUUID)
        : (synapse as SynapseInternal).from;

      if (from === undefined) {
        const si = synapse as SynapseInternal;
        if (si.from === undefined) {
          throw new Error(
            se.fromUUID + ") FROM is undefined",
          );
        } else {
          console.warn("FROM UUID is undefined using index", si.from);
          from = si.from;
        }
      }
      const to = se.toUUID
        ? uuidMap.get(se.toUUID)
        : (synapse as SynapseInternal).to;

      if (to === undefined) {
        throw new Error(
          se.toUUID + ") TO is undefined",
        );
      }

      const connection = this.connect(
        from,
        to,
        synapse.weight,
        synapse.type,
      );

      if (synapse.tags) {
        connection.tags = synapse.tags.slice();
      }

      if ((synapse as SynapseTrace).trace) {
        const cs = this.state.connection(connection.from, connection.to);
        const trace = (synapse as SynapseTrace).trace;
        Object.assign(cs, trace);
      }
    }

    this.memetic = json.memetic;
    this.clearCache();

    if (validate) {
      creatureValidate(this);
    }
  }

  /**
   * Convert a json object to a creature
   */
  static fromJSON(
    json: CreatureInternal | CreatureExport,
    validate = false,
  ): Creature {
    const creature = new Creature(json.input, json.output, {
      lazyInitialization: true,
    });

    const legacy = (json as unknown) as {
      nodes?: [];
      neurons?: [];
      connections?: [];
      synapses?: [];
    };
    if (legacy.nodes) {
      legacy.neurons = legacy.nodes;
      delete legacy.nodes;
    }
    if (legacy.connections) {
      legacy.synapses = legacy.connections;
      delete legacy.connections;
    }
    creature.loadFrom(json, validate);

    return creature;
  }
}
