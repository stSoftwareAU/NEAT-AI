import { assert } from "@std/assert/assert";
import { fail } from "@std/assert/fail";
import { yellow } from "@std/fmt/colors";
import { format } from "@std/fmt/duration";
import { emptyDirSync } from "@std/fs";
import {
  addTag,
  getTag,
  removeTag,
  type TagInterface,
} from "@stsoftware/tags/mod";
import { Mutation } from "../mod.ts";
import type {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "./architecture/CreatureInterfaces.ts";
import { CreatureState } from "./architecture/CreatureState.ts";
import { creatureValidate } from "./architecture/CreatureValidate.ts";
import {
  type DataRecordInterface,
  makeDataDir,
} from "./architecture/DataSet.ts";
import type { DiscoverRecord } from "./architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { Neuron } from "./architecture/Neuron.ts";
import type {
  NeuronExport,
  NeuronInternal,
  NeuronTrace,
} from "./architecture/NeuronInterfaces.ts";
import { calculate as calculateScore } from "./architecture/Score.ts";
import { Synapse } from "./architecture/Synapse.ts";
import type {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "./architecture/SynapseInterfaces.ts";
import { dataFiles } from "./architecture/Training.ts";
import type { MemeticInterface } from "./blackbox/MemeticInterface.ts";
import { removeHiddenNeuron } from "./compact/CompactUtils.ts";
import { createNeatConfig } from "./config/NeatConfig.ts";
import type { NeatOptions } from "./config/NeatOptions.ts";
import { type CostInterface, Costs } from "./Costs.ts";
import { Activations } from "./methods/activations/Activations.ts";
import { IDENTITY } from "./methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "./methods/activations/types/LOGISTIC.ts";
import { WorkerHandler } from "./multithreading/workers/WorkerHandler.ts";
import { AddBackCon } from "./mutate/AddBackCon.ts";
import { AddConnection } from "./mutate/AddConnection.ts";
import { AddNeuron } from "./mutate/AddNeuron.ts";
import { AddSelfCon } from "./mutate/AddSelfCon.ts";
import { ModActivation as ModSquash } from "./mutate/ModSquash.ts";
import { ModBias } from "./mutate/ModBias.ts";
import { ModWeight } from "./mutate/ModWeight.ts";
import type { RadioactiveInterface } from "./mutate/RadioactiveInterface.ts";
import { SubBackCon } from "./mutate/SubBackCon.ts";
import { SubConnection } from "./mutate/SubConnection.ts";
import { SubNeuron } from "./mutate/SubNeuron.ts";
import { SubSelfCon } from "./mutate/SubSelfCon.ts";
import { SwapNeurons } from "./mutate/SwapNeurons.ts";
import type { Approach } from "./NEAT/LogApproach.ts";
import { Neat } from "./NEAT/Neat.ts";
import { makeCreatureActivationFunction } from "./optimize/MakeCreatureActivationFunction.ts";
import {
  type BackPropagationConfig,
  createBackPropagationConfig,
} from "./propagate/BackPropagation.ts";
import { SparseConfig } from "./propagate/sparse/SparseConfig.ts";
import { upgradeOne } from "./upgrade/UpgradeOne.ts";
import { CreatureUtil } from "./architecture/CreatureUtils.ts";

interface CreatureOptions {
  semanticVersion?: string;
  lazyInitialization?: boolean;
  layers?: { squash?: string; count: number }[];
  outputLayer?: {
    squash?: string;
  };
}

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

  /** Records the origins of this creature. */
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

  /** The version of this creature */
  public semanticVersion: string;

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
    options: CreatureOptions = {},
  ) {
    this.input = input;
    this.output = output;
    this.neurons = [];
    this.synapses = [];

    this.tags = undefined;
    this.score = undefined;
    this.semanticVersion = options.semanticVersion ?? "0.0.1";

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
    if (from === -1 || to === -1) {
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
    outputLayer?: {
      squash?: string;
    };
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
          let tmpSquash = layer.squash ?? "*";
          if (tmpSquash === "*") {
            tmpSquash = Activations.pickRandomSquash();
            fixNeeded = true;
          }

          const neuron = new Neuron(
            crypto.randomUUID(),
            "hidden",
            Math.random() * 0.2 - 0.1,
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
        let squash = Activations.pickRandomSquash();
        if (options.outputLayer?.squash) {
          squash = options.outputLayer.squash;
        } else {
          fixNeeded = true;
        }
        const neuron = new Neuron(
          `output-${indx}`,
          type,
          Math.random() * 0.2 - 0.1,
          this,
          squash,
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
          Math.random() * 0.2 - 0.1,
          this,
          Activations.pickRandomSquash(),
        );
        neuron.index = this.neurons.length;
        this.neurons.push(neuron);
        fixNeeded = true;
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
    delete this.score;
    this.state.clear();
  }

  private creatureActivationFunction?: () => undefined;
  private prepareNeurons() {
    if (this.state.preparedNeurons) {
      return;
    }

    this.creatureActivationFunction =
      makeCreatureActivationFunction(this).inlineFunction;
    for (let i = this.input, len = this.neurons.length; i < len; i++) {
      this.neurons[i].prepare();
    }
    this.state.preparedNeurons = true;
  }

  /**
   * Activates the creature and traces the activity.
   *
   * @param {Float32Array} input - The input values for the creature.
   * @param {boolean} feedbackLoop - Whether to use a feedback loop during activation.
   * @returns {Float32Array} The output values after activation.
   */
  activateAndTrace(
    input: Float32Array,
    feedbackLoop: boolean,
    sparseConfig: SparseConfig,
  ): Float32Array {
    this.prepareNeurons();
    const activations = this.state.makeActivation(input, feedbackLoop);

    const neurons = this.neurons;
    const len = neurons.length;

    for (let i = this.input; i < len; i++) {
      const n = neurons[i];
      if (sparseConfig.traceNeeded(n.uuid)) {
        n.activateAndTraceNeuron();
      } else {
        n.activateNeuron();
      }
    }

    const lastHiddenNode = len - this.output;
    return new Float32Array(activations.subarray(lastHiddenNode));
  }

  /**
   * Activates the creature without calculating traces.
   *
   * @param {Float32Array} input - The input values for the creature.
   * @param {boolean} [feedbackLoop=false] - Whether to use a feedback loop during activation.
   * @returns {Float32Array} The output values after activation.
   */
  activate(input: Float32Array, feedbackLoop: boolean = false): Float32Array {
    this.prepareNeurons();
    const activations = this.state.makeActivation(input, feedbackLoop);

    this.creatureActivationFunction!();

    const lastHiddenNode = this.neurons.length - this.output;
    return new Float32Array(activations.subarray(lastHiddenNode));
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
    for (let changes = 0; complete === false; changes++) {
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

        if (fromList.length === 0) {
          removeHiddenNeuron(compactCreature, pos);
          complete = false;
        } else {
          const toList = compactCreature.inwardConnections(pos).filter(
            (c: SynapseInternal) => {
              return c.from !== c.to;
            },
          );
          if (toList.length === 1) {
            const fromList = compactCreature.outwardConnections(pos).filter(
              (c: SynapseInternal) => {
                return c.from !== c.to;
              },
            );
            if (fromList.length === 1) {
              const to = fromList[0].to;
              const from = toList[0].from;

              const fromSquash = compactCreature.neurons[from].squash;
              if (
                from > this.input &&
                fromSquash ===
                  compactCreature.neurons[pos].squash &&
                (fromSquash === IDENTITY.NAME || fromSquash === LOGISTIC.NAME)
              ) {
                if (compactCreature.getSynapse(from, to) === null) {
                  const weightA = fromList[0].weight * toList[0].weight;
                  assert(Number.isFinite(weightA), "weightA is not finite");

                  const tmpFromBias = compactCreature.neurons[from].bias;
                  const tmpToBias = compactCreature.neurons[pos].bias;
                  const biasA = tmpFromBias * toList[0].weight + tmpToBias;
                  assert(Number.isFinite(biasA), "biasA is not finite");

                  compactCreature.neurons[from].bias = biasA;

                  removeHiddenNeuron(compactCreature, pos);
                  let adjustedTo = to;
                  if (adjustedTo > pos) {
                    adjustedTo--;
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
    if (JSON.stringify(json) !== JSON.stringify(json2)) {
      addTag(compactCreature, "approach", "compact" as Approach);
      delete compactCreature.memetic;
      removeTag(compactCreature, "approach-logged");
      addTag(compactCreature, "old-neurons", this.neurons.length.toString());
      addTag(
        compactCreature,
        "old-synapses",
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
        if (c.to === indx && c.from === indx) {
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
      results = this.bulkLoadInwardConnections(toIndx);
    }
    return results;
  }

  /**
   * Precompiles all inward connections and caches them for fast lookup.
   */
  private bulkLoadInwardConnections(toIndx: number): Synapse[] {
    const cacheTo = this.cacheTo;
    cacheTo.clear();
    assert(this.neurons.length > 0, "Neurons length is zero");
    assert(toIndx < this.neurons.length, "toIndx is out of bounds");
    assert(toIndx >= 0, "toIndx must be positive");
    for (let indx = 0, len = this.neurons.length; indx < len; indx++) {
      cacheTo.set(indx, []);
    }
    // Group synapses by their 'to' index
    for (let i = 0, len = this.synapses.length; i < len; i++) {
      const synapse = this.synapses[i];
      const to = synapse.to;
      const tmpResults = cacheTo.get(to);
      assert(tmpResults, "tmpResults is undefined");
      tmpResults.push(synapse);
    }

    const results = cacheTo.get(toIndx);
    assert(results, "results is undefined");
    return results!;
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
      if (c.to === to) {
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
        assert(c.to !== to, "Connection already exists");

        if (c.to < to) {
          location = indx + 1;
          break;
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
  applyLearnings(
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): boolean {
    this.propagateUpdate(config, sparseConfig);

    let changed = false;
    for (let indx = this.neurons.length - 1; indx >= this.input; indx--) {
      if (config.trainingMutationRate > Math.random()) {
        const n = this.neurons[indx];
        if (sparseConfig.updateNeeded(n.uuid)) {
          changed ||= n.applyLearnings();
        }
      }
    }

    if (changed) {
      delete this.uuid;
      delete this.memetic;
      this.state.preparedNeurons = false;
      this.fix();
    }

    return changed;
  }

  /**
   * Propagate the expected values through the creature's network.
   *
   * @param {Float32Array} expected - The expected output values.
   * @param {BackPropagationConfig} config - The back propagation configuration.
   */
  propagate(
    expected: Float32Array,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ) {
    this.state.cacheAdjustedActivation.clear();

    const neurons = this.neurons;
    const lastOutputIndx = neurons.length - this.output;

    for (let indx = this.output; indx--;) {
      const nodeIndex = lastOutputIndx + indx;

      const n = neurons[nodeIndex];

      if (sparseConfig.propagateNeeded(n.uuid)) {
        n.propagate(
          expected[indx],
          config,
          sparseConfig,
        );
      }
    }
  }

  /**
   * Record the expected values for back propagation.
   *
   * @param {Float32Array} expected - The expected output values.
   * @param {BackPropagationConfig} config - The back propagation configuration.
   */
  record(
    expected: Float32Array,
  ): Map<string, DiscoverRecord> {
    const neurons = this.neurons;
    const lastOutputIndx = neurons.length - this.output;

    const errorMap = new Map<string, DiscoverRecord>();
    for (let indx = this.output; indx--;) {
      const nodeIndex = lastOutputIndx + indx;

      const n = neurons[nodeIndex];

      n.record(
        expected[indx],
        errorMap,
      );
    }

    return errorMap;
  }

  /**
   * Update the propagated values in the creature's network.
   *
   * @param {BackPropagationConfig} config - The back propagation configuration.
   */
  propagateUpdate(config: BackPropagationConfig, sparseConfig: SparseConfig) {
    for (let indx = this.input; indx < this.neurons.length; indx++) {
      const n = this.neurons[indx];
      if (sparseConfig.updateNeeded(n.uuid)) {
        n.propagateUpdate(config);
      }
    }
    this.state.preparedNeurons = false;
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
  ): Promise<
    { error: number; score: number; time: number; generation: number }
  > {
    let interrupted = false;
    const signalListener = () => {
      console.log("SIGTERM received, saving progress...");
      interrupted = true;
    };

    Deno.addSignalListener("SIGTERM", signalListener);

    const start = Date.now();
    const config = createNeatConfig(options);

    const endTimeMS = config.timeoutMinutes
      ? start + Math.max(1, config.timeoutMinutes) * 60000
      : 0;

    const workers: WorkerHandler[] = [];

    const threads = config.threads;

    for (let i = threads; i--;) {
      workers.push(
        new WorkerHandler(dataSetDir, config.costName, threads === 1),
      );
    }

    // Initialize the NEAT instance
    const neat = new Neat(
      this.input,
      this.output,
      config,
      workers,
    );

    neat.populatePopulation(this);

    let error = Infinity;
    let bestScore = -Infinity;
    let bestCreature: Creature | undefined;

    let iterationStartMS = Date.now();
    let generation = 0;
    const targetError = config.targetError;
    const iterations = config.iterations;

    while (true) {
      // deno-lint-ignore no-await-in-loop
      const result = await neat.evolve(
        bestCreature,
      );

      const fittest: Creature = result.fittest;
      const fittestScore = fittest.score!;
      assert(fittestScore >= bestScore, "Score is less than best score");
      if (fittestScore > bestScore) {
        const errorTmp = getTag(fittest, "error");
        assert(errorTmp, "No error tag found");

        error = Number.parseFloat(errorTmp);
        assert(Number.isFinite(error), "Error is not finite");
        assert(error >= 0, "Error is negative");
        assert(
          fittestScore - 1 <= error * -1,
          "Score (absolute) less than error",
        );
        bestScore = fittestScore;
        bestCreature = Creature.fromJSON(fittest.exportJSON());
        bestCreature.uuid = fittest.uuid;
        bestCreature.score = bestScore;
      }

      const now = Date.now();
      const timedOut = endTimeMS ? now > endTimeMS : false;

      generation++;

      const completed = interrupted || timedOut || error <= targetError ||
        generation >= iterations;

      if (
        config.log &&
        (generation % config.log === 0 || completed)
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
          (config.log > 1 ? "avg " : "") + "time",
          yellow(
            format(Math.round((now - iterationStartMS) / config.log), {
              ignoreZero: true,
            }),
          ),
        );

        iterationStartMS = now;
      }

      if (completed) {
        if (interrupted) break;
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
      this.loadFrom(bestCreature, config.debug ?? false);
    }

    if (config.creatureStore) {
      this.writeCreatures(neat, config.creatureStore);
    }

    Deno.removeSignalListener("SIGTERM", signalListener);
    return {
      error: error,
      score: bestScore,
      generation: generation,
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
    const config = createNeatConfig(options);

    const dataSetDir = makeDataDir(dataSet, config.dataSetPartitionBreak);

    const result = await this.evolveDir(dataSetDir, config);

    Deno.removeSync(dataSetDir, { recursive: true });

    return result;
  }

  /**
   * Score the creature using a dataset.
   *
   * @param dataDir The directory containing the dataset.
   * @param options The NEAT configuration options.
   * @returns the score and error of the creature.
   */
  scoreDir(
    dataDir: string,
    options: NeatOptions,
  ): { score: number; error: number } {
    const config = createNeatConfig(options);

    const result = this.evaluateDir(
      dataDir,
      Costs.find(config.costName),
      config.feedbackLoop,
    );

    this.score = calculateScore(
      this,
      result.error,
      config.costOfGrowth,
    );
    return { error: result.error, score: this.score };
  }

  /**
   * Trace the creature using a dataset.
   *
   * @param dataDir The directory containing the dataset.
   * @param options The NEAT configuration options.
   * @returns the score and error of the creature.
   */
  traceDir(
    dataDir: string,
    options: NeatOptions,
  ): { score: number; error: number } {
    const dataResult = dataFiles(dataDir);
    assert(dataResult.files.length > 0, "No data files found");
    const config = createNeatConfig(options);
    const cost = Costs.find(config.costName);
    let error = 0;
    let count = 0;
    const backPropConfig = createBackPropagationConfig(config);
    const sparseConfig = new SparseConfig(
      this.exportJSON(),
      backPropConfig,
    );

    const valuesCount = this.input + this.output;
    const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes
    const SSD_OPTIMAL_READ_SIZE = 128 * 1024; // 128 KB
    const BATCH_SIZE = Math.max(
      1,
      Math.floor(SSD_OPTIMAL_READ_SIZE / BYTES_PER_RECORD),
    );
    const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

    // Shared buffers for batch processing
    const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
    const batchArray = new Float32Array(batchBuffer.buffer);

    for (let fileIndx = dataResult.files.length; fileIndx--;) {
      const filePath = dataResult.files[fileIndx];
      const file = Deno.openSync(filePath, { read: true });

      try {
        while (true) {
          // Read a batch of records
          const bytesRead = file.readSync(batchBuffer);
          if (bytesRead === null) {
            break;
          }
          assert(bytesRead > 0, "Invalid number of bytes read");

          const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
          assert(
            bytesRead % BYTES_PER_RECORD === 0,
            "Invalid number of bytes read",
          );

          // Process each record in the batch
          for (let recordIndex = 0; recordIndex < recordsRead; recordIndex++) {
            const offset = recordIndex * valuesCount;
            const inputEnd = offset + this.input;
            const observations = batchArray.subarray(
              offset,
              inputEnd,
            );

            const actuals = this.activateAndTrace(
              observations,
              true,
              sparseConfig,
            );

            const targets = batchArray.subarray(
              inputEnd,
              offset + valuesCount,
            );
            this.propagate(targets, backPropConfig, sparseConfig);

            error += cost.calculate(targets, actuals);
            count++;
          }
        }
      } finally {
        file.close();
      }
    }
    let averageError = 0;
    if (count > 0) {
      averageError = error / count;
    }
    this.score = calculateScore(
      this,
      averageError,
      config.costOfGrowth,
    );

    return { error: averageError, score: this.score };
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
    assert(dataResult.files.length > 0, "No data files found");

    let error = 0;
    let count = 0;

    const valuesCount = this.input + this.output;
    const BYTES_PER_RECORD = valuesCount * 4; // Each float is 4 bytes
    const SSD_OPTIMAL_READ_SIZE = 128 * 1024; // 128 KB
    const BATCH_SIZE = Math.max(
      1,
      Math.floor(SSD_OPTIMAL_READ_SIZE / BYTES_PER_RECORD),
    );
    const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

    // Shared buffers for batch processing
    const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
    const batchArray = new Float32Array(batchBuffer.buffer);

    for (let fileIndx = dataResult.files.length; fileIndx--;) {
      const filePath = dataResult.files[fileIndx];
      const file = Deno.openSync(filePath, { read: true });

      try {
        while (true) {
          // Read a batch of records
          const bytesRead = file.readSync(batchBuffer);
          if (bytesRead === null) {
            break;
          }
          assert(bytesRead > 0, "Invalid number of bytes read");

          const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
          assert(
            bytesRead % BYTES_PER_RECORD === 0,
            "Invalid number of bytes read",
          );

          // Process each record in the batch
          for (let recordIndex = 0; recordIndex < recordsRead; recordIndex++) {
            const offset = recordIndex * valuesCount;
            const inputEnd = offset + this.input;
            const observations = batchArray.subarray(
              offset,
              inputEnd,
            );

            const actual = this.activate(observations, feedbackLoop);

            const target = batchArray.subarray(
              inputEnd,
              offset + valuesCount,
            );

            error += cost.calculate(target, actual);
            count++;
          }
        }
      } finally {
        file.close();
      }
    }
    if (count === 0) {
      return { error: 0 };
    } else {
      const averageError = error / count;
      if (Number.isFinite(averageError)) {
        return { error: averageError };
      } else {
        console.warn(
          `AverageError: ${averageError} is not finite, Error: ${error}, Count: ${count}`,
        );
        return { error: Number.MAX_SAFE_INTEGER };
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
    if (!focusList || focusList.length === 0) {
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

      if (index === focusIndex) {
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
    assert(toType !== "input", "Can't connect to input");
    assert(toType !== "constant", "Can't connect to constant");

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
    assert(method.name, "Mutate name is required");
    const startUUID = CreatureUtil.makeUUID(this);
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
      case Mutation.MOD_SQUASH.name:
        mutator = new ModSquash(this);
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
        mutator = new SwapNeurons(this);
        break;
      default: {
        throw new Error("unknown: " + method);
      }
    }

    let changed = false;
    changed = mutator.mutate(focusList);

    if (!changed && (!focusList || focusList.length === 0)) {
      console.info(
        `${method.name} didn't mutate the creature. ${this.input} observations, ${
          this.neurons.length - this.input - this.output
        } neurons, ${this.output} outputs, ${this.synapses.length} synapses`,
      );
    }

    if (changed) {
      delete this.uuid;
      this.state.preparedNeurons = false;
      this.fix();
    }
    if (this.DEBUG) {
      creatureValidate(this);
    }

    const endUUID = CreatureUtil.makeUUID(this);
    if (startUUID === endUUID) {
      console.warn(
        `UUID didn't change after ${method.name} mutation, changed: ${changed}`,
      );
      return false;
    } else {
      return true;
    }
  }

  /**
   * Fix the structure of the creature.
   */
  fix() {
    const holdDebug = this.DEBUG;
    this.DEBUG = false;
    const startUUID = CreatureUtil.makeUUID(this);
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
        if (this.neurons[synapse.to].type === "output") {
          /** Don't remove the last one for an output neuron */
          if (this.inwardConnections(synapse.to).length === 1) {
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
        if (this.neurons[pos].type === "output") continue;
        if (
          this.outwardConnections(pos).filter((c) => {
            return c.from !== c.to;
          }).length === 0
        ) {
          removeHiddenNeuron(this, pos);
          neuronRemoved = true;
          break;
        }
      }
    }

    this.neurons.forEach((neuron) => {
      neuron.fix();
    });

    const tmpDebug = this.DEBUG;
    this.DEBUG = false;
    delete this.uuid;
    const endUUID = CreatureUtil.makeUUID(this);
    this.DEBUG = tmpDebug;
    if (startUUID !== endUUID) {
      delete this.memetic;
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
      semanticVersion: this.semanticVersion,
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
      if (neuron.type === "input") continue;

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

    const state = this.state;
    const traceNeurons = Array<NeuronTrace>(json.neurons.length);
    let exportIndex = 0;
    this.neurons.forEach((n) => {
      if (n.type !== "input") {
        const indx = n.index;

        const traceNeuron: NeuronExport = json
          .neurons[exportIndex] as NeuronTrace;

        if (n.type !== "constant") {
          const ns = state.node(indx);
          if (ns.count) {
            (traceNeuron as NeuronTrace).trace = ns;
          }
        }
        traceNeurons[exportIndex] = traceNeuron as NeuronTrace;
        exportIndex++;
      }
    });
    json.neurons = traceNeurons;
    const traceConnections = Array<SynapseTrace>(json.synapses.length);
    this.synapses.forEach((c, indx) => {
      const exportConnection = json.synapses[indx] as SynapseTrace;
      const cs = state.connection(c.from, c.to);
      if (cs.count) {
        exportConnection.trace = cs;
      }

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

      if (neuron.type === "input") continue;

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
    if (json.semanticVersion) {
      this.semanticVersion = json.semanticVersion;
    }

    // Preallocate arrays
    const neuronCount = json.neurons.length;
    const synapseCount = json.synapses.length;
    this.neurons = new Array(neuronCount);
    this.synapses = new Array(synapseCount);

    if (json.tags) {
      this.tags = [...json.tags];
    }

    this.clearState();
    const state = this.state;
    const uuidMap = new Map<string, number>();

    // Optimize input neuron initialization
    let i = json.input;
    while (i--) {
      const key = `input-${i}`;
      uuidMap.set(key, i);
      const n = new Neuron(key, "input", 0, this);
      n.index = i;
      this.neurons[i] = n;
    }

    let pos = json.input;
    let outputIndex = 0;
    const neurons = json.neurons;

    // Process remaining neurons
    for (let i = 0; i < neurons.length; i++) {
      const jn = neurons[i];

      if (jn.type === "input") continue;

      if (jn.type === "output") {
        (jn as { uuid: string }).uuid = `output-${outputIndex++}`;
      }

      const n = Neuron.fromJSON(jn, this);
      n.index = pos;

      if ((jn as NeuronTrace).trace) {
        Object.assign(state.node(n.index), (jn as NeuronTrace).trace);
      }

      uuidMap.set(n.uuid, pos);
      this.neurons[pos++] = n;
    }

    // Optimize synapse processing
    const synapses = json.synapses;
    let isSorted = true;
    let lastFrom = -1;
    let lastTo = -1;
    for (let i = 0; i < synapseCount; i++) {
      const synapse = synapses[i];
      const se = synapse as SynapseExport;
      const from = se.fromUUID
        ? uuidMap.get(se.fromUUID)
        : (synapse as SynapseInternal).from;

      assert(from !== undefined, "FROM is undefined");

      const to = se.toUUID
        ? uuidMap.get(se.toUUID)
        : (synapse as SynapseInternal).to;

      if (to === undefined) {
        fail(
          `TO is undefined: uuid ${se.toUUID}, index ${
            (synapse as SynapseInternal).to
          }`,
        );
      }

      if (isSorted) {
        if (from > lastFrom) {
          lastFrom = from;
          lastTo = -1;
        } else if (from < lastFrom || to <= lastTo) {
          isSorted = false;
        }
        lastTo = to;
      }

      const tmpSynapse = new Synapse(from!, to!, synapse.weight, synapse.type);
      this.synapses[i] = tmpSynapse;

      if (synapse.tags) {
        tmpSynapse.tags = synapse.tags.slice();
      }

      if ((synapse as SynapseTrace).trace) {
        Object.assign(
          state.connection(tmpSynapse.from, tmpSynapse.to),
          (synapse as SynapseTrace).trace,
        );
      }
    }

    this.memetic = json.memetic;
    this.clearCache();

    // Perform sorting only if needed
    if (!isSorted) {
      this.synapses.sort((
        a,
        b,
      ) => (a.from === b.from ? a.to - b.to : a.from - b.from));
    }

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
    const semanticVersion = json.semanticVersion ?? "0.0.1";
    if (semanticVersion.startsWith("0.")) {
      json = upgradeOne(json);
    }

    const creature = new Creature(json.input, json.output, {
      lazyInitialization: true,
      semanticVersion: json.semanticVersion,
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
