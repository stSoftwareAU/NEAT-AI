import { yellow } from "https://deno.land/std@0.221.0/fmt/colors.ts";
import { format } from "https://deno.land/std@0.221.0/fmt/duration.ts";
import { emptyDirSync } from "https://deno.land/std@0.221.0/fs/empty_dir.ts";
import {
  addTag,
  getTag,
  TagInterface,
} from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { BackPropagationConfig } from "./architecture/BackPropagation.ts";
import { Synapse } from "./architecture/Synapse.ts";
import {
  SynapseExport,
  SynapseInternal,
  SynapseTrace,
} from "./architecture/SynapseInterfaces.ts";
import {
  CreatureExport,
  CreatureInternal,
  CreatureTrace,
} from "./architecture/CreatureInterfaces.ts";
import { CreatureState } from "./architecture/CreatureState.ts";
import { DataRecordInterface, makeDataDir } from "./architecture/DataSet.ts";
import { Neat } from "./architecture/Neat.ts";
import { Neuron } from "./architecture/Neuron.ts";
import {
  NeuronExport,
  NeuronInternal,
  NeuronTrace,
} from "./architecture/NeuronInterfaces.ts";
import { cacheDataFile, dataFiles } from "./architecture/Training.ts";
import { NeatOptions } from "./config/NeatOptions.ts";
import { NeatConfig } from "./architecture/Neat.ts";
import { CostInterface } from "./Costs.ts";
import { Activations } from "./methods/activations/Activations.ts";
import { IDENTITY } from "./methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "./methods/activations/types/LOGISTIC.ts";
import { Mutation } from "./methods/mutation.ts";
import { WorkerHandler } from "./multithreading/workers/WorkerHandler.ts";
import { CreatureUtil } from "../mod.ts";
import { NeuronStateInterface } from "./architecture/CreatureState.ts";
import { removeHiddenNeuron } from "./compact/CompactUtils.ts";
import { compactUnused } from "./compact/CompactUnused.ts";
import { assert } from "https://deno.land/std@0.221.0/assert/mod.ts";
import { creatureValidate } from "./architecture/CreatureValidate.ts";

export class Creature implements CreatureInternal {
  /* ID of this creature */
  uuid?: string;

  input: number;
  output: number;
  neurons: Neuron[];
  tags?: TagInterface[];
  score?: number;
  synapses: Synapse[];

  readonly state = new CreatureState(this);
  private cacheTo = new Map<number, Synapse[]>();
  private cacheFrom = new Map<number, Synapse[]>();
  private cacheSelf = new Map<number, Synapse[]>();

  DEBUG = ((globalThis as unknown) as { DEBUG: boolean }).DEBUG;

  constructor(
    input: number,
    output: number,
    options: {
      /* If true, the creature will not be initialized */
      lazyInitialization?: boolean;
      layers?: { squash?: string; count: number }[];
    } = {},
  ) {
    assert(input && output, "No input or output size given");

    this.input = input;
    this.output = output;
    this.neurons = [];
    this.synapses = [];

    this.tags = undefined;

    // Just define a variable.
    this.score = undefined;

    if (!options.lazyInitialization) {
      this.initialize(options);

      if (this.DEBUG) {
        creatureValidate(this);
      }
    }
  }

  /* Dispose of the creature and all held memory */
  public dispose() {
    this.clearState();
    this.clearCache();
    this.synapses.length = 0;
    this.neurons.length = 0;
  }

  public clearCache(from = -1, to = -1) {
    if (from == -1 || to == -1) {
      this.cacheTo.clear();
      this.cacheFrom.clear();
      this.cacheSelf.clear();
    } else {
      this.cacheTo.delete(to);
      this.cacheFrom.delete(from);
      this.cacheSelf.delete(from);
    }
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

        assert(
          layer.count > 0,
          "Layer count should be positive",
        );

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
   * Clear the context of the creature
   */
  clearState() {
    this.score = undefined;
    this.state.clear();
  }

  /**
   * Activates the creature
   */
  activateAndTrace(input: number[], feedbackLoop = false) {
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
   * Activates the creature without calculating traces and such
   */
  activate(input: number[], feedbackLoop = false) {
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
   * Compact the creature.
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
    if (JSON.stringify(json, null, 2) != JSON.stringify(json2, null, 2)) {
      addTag(compactCreature, "approach", "compact");
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

  validate() {
    creatureValidate(this);
  }

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
   * Afferent Connections (Incoming): These are connections to a neuron.
   * The term "afferent" is derived from Latin, where "ad-" means "to" and "ferre" means "carry."
   * So, afferent connections carry signals to a neuron. In the context of biological neuroscience,
   * these would correspond to the synapses that receive signals from the axons of other neurons
   * onto a neuron's dendrites or cell body (soma).
   *
   * @param toIndx the connections to this neuron by index
   * @returns the list of connections to the neuron.
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
   * Efferent Connections (Outgoing): These are connections from a neuron to other neurons.
   * The term "efferent" comes from "ex-" meaning "out of" and "ferre."
   * Efferent connections carry signals away from the neuron.
   * In biological terms, these would be the synapses where a neuron's axon terminals make connections
   * with other neurons' dendrites or cell bodies, transmitting the signal onward.
   *
   * @param fromIndx the connections from this neuron by index
   * @returns the list of connections from the neuron.
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
   * Connects the from neuron to the to node
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
          throw new Error(
            indx + ") already connected from: " + this.neurons[from].ID() +
              " to: " + this.neurons[to].ID(),
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
   * Disconnects the from neuron from the to node
   */
  disconnect(from: number, to: number) {
    const connections = this.synapses;

    let found = false;
    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.from === from && connection.to === to) {
        found = true;
        connections.splice(i, 1);
        this.clearCache(from, to);

        break;
      }
    }

    assert(found, "Can't disconnect");
  }

  async applyLearnings(config: BackPropagationConfig) {
    this.propagateUpdate(config);

    const compacted = await compactUnused(
      this.traceJSON(),
      config.plankConstant,
    );
    if (compacted) {
      this.loadFrom(compacted.exportJSON(), false);
      return true;
    }

    const oldConnections = this.synapses.length;
    const oldNodes = this.neurons.length;
    let changed = false;
    for (let i = this.neurons.length; i--;) {
      const n = this.neurons[i];
      if (n.type == "input") break;
      changed ||= n.applyLearnings();
    }

    if (changed) {
      this.fix();
      const temp = this.compact();
      if (temp) {
        temp.fix();
        this.loadFrom(temp.exportJSON(), true);
      }
      addTag(this, "approach", "Learnings");
      addTag(this, "old-nodes", oldNodes.toString());
      addTag(
        this,
        "old-connections",
        oldConnections.toString(),
      );
    }
    return changed;
  }

  /**
   * Back propagate the creature
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
   * Back propagate the creature
   */
  propagateUpdate(config: BackPropagationConfig) {
    assert(!this.state.propagated, "Already propagated");
    this.state.propagated = true;

    // @TODO randomize the order of the neurons
    for (let indx = this.neurons.length - 1; indx >= this.input; indx--) {
      const n = this.neurons[indx];
      n.propagateUpdate(config);
    }
  }

  /**
   * Evolves the creature to reach a lower error on a dataset
   */
  async evolveDir(
    dataSetDir: string,
    options: NeatOptions,
  ) {
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

    await neat.populatePopulation(this);

    let error = Infinity;
    let bestScore = -Infinity;
    let bestCreature: Creature | undefined;

    let iterationStartMS = new Date().getTime();
    let generation = 0;
    const targetError = options.targetError ?? 0;
    const iterations = options.iterations ?? Number.POSITIVE_INFINITY;

    while (true) {
      const fittest: Creature = await neat.evolve(
        bestCreature,
      );

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
        console.log(
          "Generation",
          generation,
          "score",
          fittest.score,
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
   * Evolves the creature to reach a lower error on a dataset
   */
  async evolveDataSet(
    dataSet: DataRecordInterface[],
    options: NeatOptions,
  ) {
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
   * Tests a set and returns the error and elapsed time
   */
  evaluateDir(
    dataDir: string,
    cost: CostInterface,
    feedbackLoop: boolean,
  ) {
    const files: string[] = dataFiles(dataDir).map((fn) => `${dataDir}/${fn}`);

    if (files.length === 1) {
      const fn = files[0];
      const json = cacheDataFile.fn === fn
        ? cacheDataFile.json
        : JSON.parse(Deno.readTextFileSync(fn));

      cacheDataFile.fn = fn;
      cacheDataFile.json = json;

      const result = this.evaluateData(json, cost, feedbackLoop);
      return { error: result.error / result.count };
    } else {
      cacheDataFile.fn = "";
      cacheDataFile.json = {};
      let totalCount = 0;
      let totalError = 0;
      for (let i = files.length; i--;) {
        const json = JSON.parse(Deno.readTextFileSync(files[i]));

        const result = this.evaluateData(json, cost, feedbackLoop);
        totalCount += result.count;
        totalError += result.error;
      }
      return { error: totalError / totalCount };
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

  inFocus(index: number, focusList?: number[], checked = new Set()) {
    if (!focusList || focusList.length == 0) return true;

    if (checked.has(index)) return false;

    checked.add(index);

    for (let pos = 0; pos < focusList.length; pos++) {
      const focusIndex = focusList[pos];

      if (index == focusIndex) {
        return true;
      }

      const toList = this.inwardConnections(index);

      for (let i = toList.length; i--;) {
        const checkIndx: number = toList[i].from;
        if (checkIndx === index) return true;

        if (this.inFocus(checkIndx, focusList, checked)) {
          return true;
        }
      }
    }
    return false;
  }

  public subNeuron(focusList?: number[]) {
    // Check if there are neurons left to remove
    if (this.neurons.length === this.input + this.output) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      // Select a neuron which isn't an input or output neuron
      const indx = Math.floor(
        Math.random() *
            (this.neurons.length - this.output - this.input) +
          this.input,
      );

      if (!this.inFocus(indx, focusList)) continue;
      removeHiddenNeuron(this, indx);
      break;
    }
  }

  public addNeuron(focusList?: number[]) {
    const neuron = new Neuron(crypto.randomUUID(), "hidden", undefined, this);

    // Random squash function
    neuron.mutate(Mutation.MOD_ACTIVATION.name);

    let indx = Math.floor(
      Math.random() *
        (this.neurons.length - this.output - this.input + 1),
    ) + this.input;

    while (this.neurons[indx].type == "constant") {
      indx++;
    }
    neuron.index = indx;
    this.insertNeuron(neuron);

    let tmpFocusList = focusList;
    let fromIndex = -1;
    let toIndex = -1;

    for (let attempts = 0; attempts < 12; attempts++) {
      if (attempts >= 9) {
        /* Should work first time once we remove the "focus" */
        tmpFocusList = undefined;
      }
      if (fromIndex === -1) {
        const pos = Math.floor(
          Math.random() * neuron.index,
        );

        if (neuron.index <= pos || pos < 0) {
          throw new Error(
            `From: ${pos} should be less than neuron index: ${neuron.index}`,
          );
        }
        if (this.inFocus(pos, tmpFocusList)) {
          fromIndex = pos;
        }
      } else if (toIndex === -1) {
        const pos = Math.floor(
          Math.random() * (this.neurons.length - neuron.index),
        ) + neuron.index;

        if (neuron.index > pos) {
          throw new Error(
            "To: " + pos + " should be greater than neuron index: " +
              neuron.index,
          );
        }

        if (this.inFocus(pos, tmpFocusList)) {
          toIndex = pos;
        }
      } else {
        break;
      }
    }

    if (fromIndex !== -1) {
      this.connect(
        fromIndex,
        neuron.index,
        Synapse.randomWeight(),
      );
    } else {
      console.warn("addNeuron: Should have a from index");
    }

    if (toIndex !== -1) {
      const nonConstantIndx = this.neurons.findIndex((
        n,
      ) => (n.index >= toIndex && n.type !== "constant"));
      this.connect(
        neuron.index,
        nonConstantIndx,
        Synapse.randomWeight(),
      );
      neuron.fix();
      const connection = this.getSynapse(neuron.index, nonConstantIndx);
      if (!connection) {
        /* If the self connection was removed */
        const toIndex2 = Math.floor(
          Math.random() * (this.neurons.length - neuron.index - 1),
        ) + neuron.index + 1;

        const nonConstantIndx2 = this.neurons.findIndex((
          n,
        ) => (n.index >= toIndex2 && n.type !== "constant"));

        this.connect(
          neuron.index,
          nonConstantIndx2,
          Synapse.randomWeight(),
        );
      }
    } else {
      console.warn("addNeuron: Should have a to index");
    }
  }

  private insertNeuron(neuron: Neuron) {
    if (Number.isInteger(neuron.index) == false || neuron.index < this.input) {
      throw new Error(
        "to should be a greater than the input count was: " + neuron.index,
      );
    }

    const firstOutputIndex = this.neurons.length - this.output;
    if (neuron.index > firstOutputIndex) {
      throw new Error(
        "to should be a between than input (" + this.input +
          ") and output neurons (" + firstOutputIndex + ") was: " +
          neuron.index,
      );
    }

    if (neuron.type !== "hidden") {
      throw new Error("Should be a 'hidden' type was: " + neuron.type);
    }
    const left = this.neurons.slice(0, neuron.index);
    const right = this.neurons.slice(neuron.index);
    right.forEach((n) => {
      n.index++;
    });

    const full = [...left, neuron, ...right];

    this.neurons = full;

    this.synapses.forEach((c) => {
      if (c.from >= neuron.index) c.from++;
      if (c.to >= neuron.index) c.to++;
    });

    this.clearCache();
  }

  public addConnection(focusList?: number[], options = {
    weightScale: 1,
  }) {
    // Create an array of all uncreated (feedforward) connections
    const available = [];

    for (let i = 0; i < this.neurons.length; i++) {
      const neuronFrom = this.neurons[i];

      if (neuronFrom.index != i) {
        throw i + ") invalid neuron index: " + neuronFrom.index;
      }

      if (!this.inFocus(i, focusList)) continue;

      for (let j = Math.max(i + 1, this.input); j < this.neurons.length; j++) {
        if (!this.inFocus(j, focusList)) continue;
        const neuronTo = this.neurons[j];

        if (neuronTo.type === "constant") continue;

        if (!neuronFrom.isProjectingTo(neuronTo)) {
          available.push([neuronFrom, neuronTo]);
        }
      }
    }

    if (available.length === 0) {
      return;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    const fromIndx = pair[0].index;
    const toIndx = pair[1].index;
    const w = Synapse.randomWeight() * options.weightScale
      ? options.weightScale
      : 1;
    this.connect(
      fromIndx,
      toIndx,
      w,
    );
  }

  public makeRandomConnection(indx: number) {
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

  public subConnection(focusList?: number[]) {
    // List of possible connections that can be removed
    const possible = [];

    for (let i = 0; i < this.synapses.length; i++) {
      const conn = this.synapses[i];
      // Check if it is not disabling a node
      if (conn.to > conn.from) {
        if (
          this.inFocus(conn.to, focusList) || this.inFocus(conn.from, focusList)
        ) {
          /** Each neuron must have at least one from/to connection */
          if (
            (
              this.outwardConnections(conn.from).length > 1 ||
              this.neurons[conn.from].type === "input"
            ) && this.inwardConnections(conn.to).length > 1
          ) {
            possible.push(conn);
          }
        }
      }
    }

    if (possible.length === 0) {
      return;
    }

    const randomConn = possible[Math.floor(Math.random() * possible.length)];
    this.disconnect(randomConn.from, randomConn.to);
  }

  private modWeight(focusList?: number[]) {
    const allConnections = this.synapses.filter(
      (c) => {
        return this.inFocus(c.from, focusList) ||
          this.inFocus(c.to, focusList);
      },
    );
    if (allConnections.length > 0) {
      const pos = Math.floor(Math.random() * allConnections.length);
      const connection = allConnections[pos];
      if (connection) {
        // Calculate the quantum based on the current weight
        const weightMagnitude = Math.abs(connection.weight);
        let quantum = 1;

        if (weightMagnitude >= 1) {
          // Find the largest power of 10 smaller than the weightMagnitude
          quantum = Math.pow(10, Math.floor(Math.log10(weightMagnitude)));
        }

        // Generate a random modification value based on the quantum
        const modification = (Math.random() * 2 - 1) * quantum;

        connection.weight += modification;
      } else {
        console.warn(
          "MOD_WEIGHT: missing connection at",
          pos,
          "of",
          allConnections.length,
        );
      }
    }
  }

  public modBias(focusList?: number[]) {
    for (let attempts = 0; attempts < 12; attempts++) {
      // Has no effect on input node, so they are excluded
      const index = Math.floor(
        Math.random() * (this.neurons.length - this.input) +
          this.input,
      );
      const neuron = this.neurons[index];
      if (neuron.type === "constant") continue;
      if (!this.inFocus(index, focusList) && attempts < 6) continue;
      neuron.mutate(Mutation.MOD_BIAS.name);
      break;
    }
  }

  private modActivation(focusList?: number[]) {
    for (let attempts = 0; attempts < 12; attempts++) {
      const index = Math.floor(
        Math.random() * (
              this.neurons.length -
              this.input
            ) + this.input,
      );
      const neuron = this.neurons[index];

      if (neuron.type == "constant") continue;

      if (this.inFocus(index, focusList)) {
        neuron.mutate(Mutation.MOD_ACTIVATION.name);
        break;
      }
    }
  }

  private addSelfCon(focusList?: number[]) {
    // Check which neurons aren't self connected yet
    const possible = [];
    for (let i = this.input; i < this.neurons.length - this.output; i++) {
      if (this.inFocus(i, focusList)) {
        const neuron = this.neurons[i];
        if (neuron.type === "constant") continue;

        const c = this.selfConnection(neuron.index);
        if (c === null) {
          possible.push(neuron);
        }
      }
    }

    if (possible.length === 0) {
      return;
    }

    // Select a random node
    const neuron = possible[Math.floor(Math.random() * possible.length)];

    // Connect it to himself
    const indx = neuron.index;
    this.connect(indx, indx, Synapse.randomWeight());
  }

  private subSelfCon(focusList?: number[]) {
    // Check which neurons aren't self connected yet
    const possible = [];
    for (let i = this.input; i < this.neurons.length; i++) {
      if (this.inFocus(i, focusList)) {
        const neuron = this.neurons[i];
        const indx = neuron.index;
        const c = this.getSynapse(indx, indx);
        if (c !== null) {
          possible.push(neuron);
        }
      }
    }

    if (possible.length === 0) {
      return;
    }

    // Select a random node
    const neuron = possible[Math.floor(Math.random() * possible.length)];

    // Connect it to himself
    const indx = neuron.index;
    this.disconnect(indx, indx);
  }

  private addBackConn(focusList?: number[]) {
    // Create an array of all uncreated (back feed) connections
    const available = [];
    for (let toIndx = this.input; toIndx < this.neurons.length; toIndx++) {
      if (this.inFocus(toIndx, focusList)) {
        const neuronTo = this.neurons[toIndx];
        for (let fromIndx = this.input; fromIndx < toIndx; fromIndx++) {
          const neuronFrom = this.neurons[fromIndx];
          if (neuronFrom.type == "output") break;
          if (neuronTo.type == "constant") continue;
          if (this.inFocus(neuronFrom.index, focusList)) {
            if (!neuronFrom.isProjectingTo(neuronTo)) {
              available.push([neuronFrom, neuronTo]);
            }
          }
        }
      }
    }

    if (available.length === 0) {
      return;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    const fromIndx = pair[0].index;
    const toIndx = pair[1].index;
    this.connect(fromIndx, toIndx, Synapse.randomWeight());
  }

  private subBackConn(focusList?: number[]) {
    // Create an array of all uncreated (back fed) connections
    const available = [];
    for (let to = this.input; to < this.neurons.length; to++) {
      if (this.inFocus(to, focusList)) {
        for (let from = 0; from < to; from++) {
          if (this.inFocus(from, focusList)) {
            if (
              (
                this.outwardConnections(from).length > 1 ||
                this.neurons[from].type === "input"
              ) && this.inwardConnections(to).length > 1
            ) {
              if (this.getSynapse(from, to) != null) {
                available.push([from, to]);
              }
            }
          }
        }
      }
    }

    if (available.length === 0) {
      return;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    this.disconnect(pair[0], pair[1]);
  }

  private swapNodes(focusList?: number[]) {
    // Has no effect on input node, so they are excluded
    if (
      (this.neurons.length - this.input < 2) ||
      (this.neurons.length - this.input - this.output < 2)
    ) {
      return;
    }

    let node1 = null;
    for (let attempts = 0; attempts < 12; attempts++) {
      const index1 = Math.floor(
        Math.random() *
            (this.neurons.length -
              this.input - this.output) + this.input,
      );

      if (this.inFocus(index1, focusList)) {
        const tmpNode = this.neurons[index1];
        if (tmpNode.type == "hidden") {
          node1 = tmpNode;
          break;
        }
      }
    }
    if (node1 == null) return;
    let node2 = null;
    for (let attempts = 0; attempts < 12; attempts++) {
      const index2 = Math.floor(
        Math.random() *
            (this.neurons.length -
              this.input - this.output) + this.input,
      );

      if (this.inFocus(index2, focusList)) {
        const tmpNode = this.neurons[index2];
        if (tmpNode.type == "hidden") {
          node2 = tmpNode;
          break;
        }
      }
    }

    if (node1 && node2) {
      const biasTemp = node1.bias;
      const squashTemp = node1.squash;

      node1.bias = node2.bias;
      node1.squash = node2.squash;
      node2.bias = biasTemp;
      node2.squash = squashTemp;

      node1.fix();
      node2.fix();
      if (this.DEBUG) creatureValidate(this);
    }
  }

  /**
   * Mutates the creature with the given method
   */
  mutate(method: { name: string }, focusList?: number[]) {
    if (typeof method.name !== "string") {
      throw new Error("Mutate method wrong type: " + (typeof method));
    }

    switch (method.name) {
      case Mutation.ADD_NODE.name: {
        this.addNeuron(focusList);
        break;
      }
      case Mutation.SUB_NODE.name: {
        this.subNeuron(focusList);

        break;
      }
      case Mutation.ADD_CONN.name: {
        this.addConnection(focusList);

        break;
      }
      case Mutation.SUB_CONN.name: {
        this.subConnection(focusList);
        break;
      }
      case Mutation.MOD_WEIGHT.name: {
        this.modWeight(focusList);

        break;
      }
      case Mutation.MOD_BIAS.name: {
        this.modBias(focusList);

        break;
      }
      case Mutation.MOD_ACTIVATION.name: {
        this.modActivation(focusList);
        break;
      }
      case Mutation.ADD_SELF_CONN.name: {
        this.addSelfCon(focusList);

        break;
      }
      case Mutation.SUB_SELF_CONN.name: {
        this.subSelfCon(focusList);

        break;
      }
      case Mutation.ADD_BACK_CONN.name: {
        this.addBackConn(focusList);

        break;
      }
      case Mutation.SUB_BACK_CONN.name: {
        this.subBackConn(focusList);

        break;
      }
      case Mutation.SWAP_NODES.name: {
        this.swapNodes(focusList);
        break;
      }
      default: {
        throw new Error("unknown: " + method);
      }
    }

    delete this.uuid;
    this.fix();
    if (this.DEBUG) {
      creatureValidate(this);
    }
  }

  /**
   * Fix the creature
   */
  fix() {
    const holdDebug = this.DEBUG;
    this.DEBUG = false;
    const startTxt = JSON.stringify(this.internalJSON(), null, 2);
    this.DEBUG = holdDebug;
    const maxTo = this.neurons.length - 1;
    const minTo = this.input;

    const connections: Synapse[] = [];
    this.synapses.forEach((c) => {
      if (c.to > maxTo) {
        console.debug("Ignoring connection to above max", maxTo, c);
      } else if (c.to < minTo) {
        console.debug("Ignoring connection to below min", minTo, c);
      } else {
        connections.push(c as Synapse);
      }
    });

    this.synapses = connections;

    /* Make sure the synapses are sorted */
    this.synapses.sort((a, b) => {
      if (a.from === b.from) {
        return a.to - b.to;
      } else {
        return a.from - b.from;
      }
    });

    this.clearCache();

    let nodeRemoved = true;

    while (nodeRemoved) {
      nodeRemoved = false;
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
          nodeRemoved = true;
          break;
        }
      }
    }

    this.neurons.forEach((node) => {
      node.fix();
    });

    const endTxt = JSON.stringify(this.internalJSON(), null, 2);
    if (startTxt != endTxt) {
      delete this.uuid;
    }
  }

  outputCount() {
    return this.output;
  }

  nodeCount() {
    return this.neurons.length;
  }

  /**
   * Convert the creature to a json object
   */
  exportJSON() {
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

    return json;
  }

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

    return json as CreatureTrace;
  }

  internalJSON() {
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

    return json;
  }

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
        if (!jn.uuid || jn.uuid.startsWith("output-") == false) {
          uuidMap.set(jn.uuid ? jn.uuid : "", pos);
          jn.uuid = `output-${outputIndx}`;
        }
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

      const from = (synapse as SynapseExport).fromUUID
        ? uuidMap.get((synapse as SynapseExport).fromUUID)
        : (synapse as SynapseInternal).from;

      if (from === undefined) {
        throw new Error(
          (synapse as SynapseExport).fromUUID + ") FROM is undefined",
        );
      }
      const to = (synapse as SynapseExport).toUUID
        ? uuidMap.get((synapse as SynapseExport).toUUID)
        : (synapse as SynapseInternal).to;

      if (to === undefined) {
        throw new Error(
          (synapse as SynapseExport).toUUID + ") TO is undefined",
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

    this.clearCache();

    if (validate) {
      creatureValidate(this);
    }
  }

  /**
   * Convert a json object to a creature
   */
  static fromJSON(json: CreatureInternal | CreatureExport, validate = false) {
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
