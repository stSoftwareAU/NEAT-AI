import { yellow } from "https://deno.land/std@0.212.0/fmt/colors.ts";
import { format } from "https://deno.land/std@0.212.0/fmt/duration.ts";
import { emptyDirSync } from "https://deno.land/std@0.212.0/fs/empty_dir.ts";
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
import { CreatureState, NeuronState } from "./architecture/CreatureState.ts";
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
import { CostInterface } from "./Costs.ts";
import { Activations } from "./methods/activations/Activations.ts";
import { IDENTITY } from "./methods/activations/types/IDENTITY.ts";
import { LOGISTIC } from "./methods/activations/types/LOGISTIC.ts";
import { Mutation } from "./methods/mutation.ts";
import { WorkerHandler } from "./multithreading/workers/WorkerHandler.ts";
import { CreatureUtil } from "../mod.ts";

export class Creature implements CreatureInternal {
  /* ID of this creature */
  uuid?: string;

  input: number;
  output: number;
  nodes: Neuron[];
  tags?: TagInterface[];
  score?: number;
  connections: SynapseInternal[];

  readonly state = new CreatureState(this);
  private cacheTo = new Map<number, SynapseInternal[]>();
  private cacheFrom = new Map<number, SynapseInternal[]>();
  private cacheSelf = new Map<number, SynapseInternal[]>();

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
    if (input === undefined || output === undefined) {
      throw new Error("No input or output size given");
    }

    this.input = input;
    this.output = output;
    this.nodes = [];
    this.connections = [];

    this.tags = undefined;

    // Just define a variable.
    this.score = undefined;

    if (!options.lazyInitialization) {
      this.initialize(options);

      if (this.DEBUG) {
        this.validate();
      }
    }
  }

  /* Dispose of the creature and all held memory */
  public dispose() {
    this.clearState();
    this.clearCache();
    this.connections.length = 0;
    this.nodes.length = 0;
  }

  public clearCache() {
    this.cacheTo.clear();
    this.cacheFrom.clear();
    this.cacheSelf.clear();
  }

  private initialize(options: {
    layers?: { squash?: string; count: number }[];
  }) {
    let fixNeeded = false;
    // Create input nodes
    for (let i = this.input; i--;) {
      const type = "input";
      const node = new Neuron(`input-${this.input - i - 1}`, type, 0, this);
      node.index = this.nodes.length;
      this.nodes.push(node);
    }

    if (options.layers) {
      let lastStartIndx = 0;
      let lastEndIndx = this.nodes.length - 1;

      for (let i = 0; i < options.layers.length; i++) {
        const layer = options.layers[i];

        if (layer.count <= 0) {
          throw new Error(`Layer count should be positive was: ${layer.count}`);
        }
        for (let j = 0; j < layer.count; j++) {
          let tmpSquash = layer.squash ? layer.squash : LOGISTIC.NAME;
          if (tmpSquash == "*") {
            tmpSquash = Activations
              .NAMES[Math.floor(Activations.NAMES.length * Math.random())];
            fixNeeded = true;
          }

          const node = new Neuron(
            crypto.randomUUID(),
            "hidden",
            undefined,
            this,
            tmpSquash,
          );
          node.index = this.nodes.length;
          this.nodes.push(node);
        }

        const tmpOutput = this.output;
        this.output = 0;

        for (let k = lastStartIndx; k <= lastEndIndx; k++) {
          for (let l = lastEndIndx + 1; l < this.nodes.length; l++) {
            this.connect(k, l, Synapse.randomWeight());
          }
        }
        this.output = tmpOutput;
        lastStartIndx = lastEndIndx + 1;
        lastEndIndx = this.nodes.length - 1;
      }

      // Create output nodes
      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        const node = new Neuron(
          `output-${indx}`,
          type,
          undefined,
          this,
          LOGISTIC.NAME,
        );
        node.index = this.nodes.length;
        this.nodes.push(node);
      }

      for (let k = lastStartIndx; k <= lastEndIndx; k++) {
        for (let l = lastEndIndx + 1; l < this.nodes.length; l++) {
          this.connect(k, l, Synapse.randomWeight());
        }
      }
    } else {
      // Create output nodes
      for (let indx = 0; indx < this.output; indx++) {
        const type = "output";
        const node = new Neuron(
          `output-${indx}`,
          type,
          undefined,
          this,
          LOGISTIC.NAME,
        );
        node.index = this.nodes.length;
        this.nodes.push(node);
      }

      // Connect input nodes with output nodes directly
      for (let i = 0; i < this.input; i++) {
        for (
          let j = this.input;
          j < this.output + this.input;
          j++
        ) {
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

  getActivation(indx: number) {
    return this.state.activations[indx];
  }

  /**
   * Activates the creature
   */
  activateAndTrace(input: number[], feedbackLoop = false) {
    const output: number[] = new Array(this.output);

    this.state.makeActivation(input, feedbackLoop);

    const lastHiddenNode = this.nodes.length - this.output;

    // Activate hidden nodes
    for (let i = this.input; i < lastHiddenNode; i++) {
      this.nodes[i].activateAndTrace();
    }

    // Activate output nodes and store their values in the output array
    for (let outIndx = 0; outIndx < this.output; outIndx++) {
      output[outIndx] = this.nodes[lastHiddenNode + outIndx].activateAndTrace();
    }

    return output;
  }

  /**
   * Activates the creature without calculating traces and such
   */
  activate(input: number[], feedbackLoop = false) {
    const output: number[] = new Array(this.output);

    this.state.makeActivation(input, feedbackLoop);

    const lastHiddenNode = this.nodes.length - this.output;

    // Activate hidden nodes
    for (let i = this.input; i < lastHiddenNode; i++) {
      this.nodes[i].activate();
    }

    // Activate output nodes and store their values in the output array
    for (let outIndx = 0; outIndx < this.output; outIndx++) {
      output[outIndx] = this.nodes[lastHiddenNode + outIndx].activate();
    }

    return output;
  }

  /**
   * Compact the creature.
   */
  compact(): Creature | null {
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
        pos < compactCreature.nodes.length - compactCreature.output;
        pos++
      ) {
        const fromList = compactCreature.fromConnections(pos).filter(
          (c: SynapseInternal) => {
            return c.from !== c.to;
          },
        );

        if (fromList.length == 0) {
          compactCreature.removeHiddenNode(pos);
          complete = false;
        } else {
          const toList = compactCreature.toConnections(pos).filter(
            (c: SynapseInternal) => {
              return c.from !== c.to;
            },
          );
          if (toList.length == 1) {
            const fromList = compactCreature.fromConnections(pos).filter(
              (c: SynapseInternal) => {
                return c.from !== c.to;
              },
            );
            if (fromList.length == 1) {
              const to = fromList[0].to;
              const from = toList[0].from;

              const fromSquash = compactCreature.nodes[from].squash;
              if (
                from > this.input &&
                fromSquash ==
                  compactCreature.nodes[pos].squash &&
                (fromSquash == IDENTITY.NAME || fromSquash == LOGISTIC.NAME)
              ) {
                if (compactCreature.getConnection(from, to) == null) {
                  let weightA = fromList[0].weight * toList[0].weight;

                  const tmpFromBias = compactCreature.nodes[from].bias;
                  const tmpToBias = compactCreature.nodes[pos].bias;
                  let biasA =
                    (tmpFromBias ? tmpFromBias : 0) * toList[0].weight +
                    (tmpToBias ? tmpToBias : 0);

                  if (biasA === Number.POSITIVE_INFINITY) {
                    biasA = Number.MAX_SAFE_INTEGER;
                  } else if (biasA === Number.NEGATIVE_INFINITY) {
                    biasA = Number.MIN_SAFE_INTEGER;
                  } else if (isNaN(biasA)) {
                    biasA = 0;
                  }

                  compactCreature.nodes[from].bias = biasA;

                  compactCreature.removeHiddenNode(pos);
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
      addTag(compactCreature, "old-nodes", this.nodes.length.toString());
      addTag(
        compactCreature,
        "old-connections",
        this.connections.length.toString(),
      );

      return compactCreature;
    } else {
      return null;
    }
  }

  /**
   * Validate the creature
   * @param options specific values to check
   */
  validate(options?: { nodes?: number; connections?: number }) {
    if (options && options.nodes) {
      if (this.nodes.length !== options.nodes) {
        throw new Error(
          `Node length: ${this.nodes.length} expected: ${options.nodes}`,
        );
      }
    }

    if (
      Number.isInteger(this.input) == false || this.input < 1
    ) {
      throw new Error(`Must have at least one input nodes was: ${this.input}`);
    }

    if (
      Number.isInteger(this.output) == false || this.output < 1
    ) {
      throw new Error(
        `Must have at least one output nodes was: ${this.output}`,
      );
    }

    const stats = {
      input: 0,
      constant: 0,
      hidden: 0,
      output: 0,
      connections: 0,
    };

    let outputIndx = 0;
    const UUIDs = new Set<string>();
    this.nodes.forEach((node, indx) => {
      const uuid = node.uuid;
      if (!uuid) {
        throw new Error(`${node.ID()}) no UUID`);
      }
      if (UUIDs.has(uuid)) {
        if (this.DEBUG) {
          this.DEBUG = false;
          Deno.writeTextFileSync(
            ".validate.json",
            JSON.stringify(this.exportJSON(), null, 2),
          );

          this.DEBUG = true;
        }
        throw new Error(`${node.ID()}) duplicate UUID: ${uuid}`);
      }
      if (uuid.startsWith("input-")) {
        if (uuid !== "input-" + indx) {
          if (this.DEBUG) {
            this.DEBUG = false;
            Deno.writeTextFileSync(
              ".validate.json",
              JSON.stringify(this.exportJSON(), null, 2),
            );

            this.DEBUG = true;
          }
          throw new Error(`${node.ID()}) invalid input UUID: ${uuid}`);
        }
      } else {
        if (!Number.isFinite(node.bias)) {
          throw new Error(`${node.ID()}) invalid bias: ${node.bias}`);
        }
      }

      if (node.type == "output") {
        const expectedUUID = `output-${outputIndx}`;
        outputIndx++;
        if (uuid !== expectedUUID) {
          if (this.DEBUG) {
            this.DEBUG = false;
            Deno.writeTextFileSync(
              ".validate.json",
              JSON.stringify(this.exportJSON(), null, 2),
            );

            this.DEBUG = true;
          }
          throw new Error(`${uuid} + ") invalid output UUID: ${uuid}`);
        }
      }

      UUIDs.add(uuid);

      if (node.squash === "IF" && indx > 2) {
        const toList = this.toConnections(indx);
        if (toList.length < 3) {
          throw new Error(
            `${node.ID()}) 'IF' should have at least 3 connections was: ${toList.length}`,
          );
        }

        let foundPositive = false;
        let foundCondition = false;
        let foundNegative = false;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          if (c.type == "condition") {
            foundCondition = true;
          } else if (c.type == "negative") {
            foundNegative = true;
          } else if (c.type == "positive") {
            foundPositive = true;
          }
        }
        if (!foundCondition || !foundPositive || !foundNegative) {
          if (this.DEBUG) {
            this.DEBUG = false;
            console.warn(
              JSON.stringify(this.exportJSON(), null, 2),
            );
            this.DEBUG = true;
          }
        }
        if (!foundCondition) {
          throw new Error(`${node.ID()}) 'IF' should have a condition(s)`);
        }
        if (!foundPositive) {
          throw new Error(
            `${node.ID()}) 'IF' should have a positive connection(s)`,
          );
        }
        if (!foundNegative) {
          throw new Error(
            `${node.ID()}) 'IF' should have a negative connection(s)`,
          );
        }
      }
      switch (node.type) {
        case "input": {
          stats.input++;
          const toList = this.toConnections(indx);
          if (toList.length > 0) {
            throw new Error(
              `'input' node ${node.ID()} has inward connections: ${toList.length}`,
            );
          }
          break;
        }
        case "constant": {
          stats.constant++;
          const toList = this.toConnections(indx);
          if (toList.length > 0) {
            throw new Error(
              `'${node.type}' node ${node.ID()}  has inward connections: ${toList.length}`,
            );
          }
          if (node.squash) {
            throw new Error(
              `Node ${node.ID()} '${node.type}' has squash: ${node.squash}`,
            );
          }
          break;
        }
        case "hidden": {
          stats.hidden++;
          const toList = this.toConnections(indx);
          if (toList.length == 0) {
            throw new Error(
              `hidden node ${node.ID()} has no inward connections`,
            );
          }
          const fromList = this.fromConnections(indx);
          if (fromList.length == 0) {
            if (this.DEBUG) {
              this.DEBUG = false;
              console.warn(
                JSON.stringify(
                  this.internalJSON(),
                  null,
                  2,
                ),
              );
              this.DEBUG = true;
            }
            throw new Error(
              `hidden node ${node.ID()} has no outward connections`,
            );
          }
          if (node.bias === undefined) {
            throw new Error(
              `hidden node ${node.ID()} should have a bias was: ${node.bias}`,
            );
          }
          if (!Number.isFinite(node.bias)) {
            throw new Error(
              `${node.ID()}) hidden node should have a finite bias was: ${node.bias}`,
            );
          }

          break;
        }
        case "output": {
          stats.output++;
          const toList = this.toConnections(indx);
          if (toList.length == 0) {
            if (this.DEBUG) {
              this.DEBUG = false;
              console.warn(
                JSON.stringify(
                  this.exportJSON(),
                  null,
                  2,
                ),
              );
              this.DEBUG = true;
            }
            throw new Error(
              `${node.ID()}) output node has no inward connections`,
            );
          }
          break;
        }
        default:
          throw new Error(`${node.ID()}) Invalid type: ${node.type}`);
      }

      if (node.index !== indx) {
        throw new Error(
          `${node.ID()}) node.index: ${node.index} does not match expected index`,
        );
      }

      if (node.creature !== this) {
        throw new Error(`node ${node.ID()} creature mismatch`);
      }
    });

    if (stats.input !== this.input) {
      throw new Error(
        `Expected ${this.input} input nodes found: ${stats.input}`,
      );
    }

    if (stats.output !== this.output) {
      throw new Error(
        `Expected ${this.output} output nodes found: ${stats.output}`,
      );
    }

    let lastFrom = -1;
    let lastTo = -1;
    this.connections.forEach((c, indx) => {
      stats.connections++;
      const toNode = this.getNode(c.to);

      if (toNode.type === "input") {
        throw new Error(indx + ") connection points to an input node");
      }

      if (c.from < lastFrom) {
        throw new Error(indx + ") connections not sorted");
      } else if (c.from > lastFrom) {
        lastTo = -1;
      }

      if (c.from == lastFrom && c.to <= lastTo) {
        throw new Error(indx + ") connections not sorted");
      }

      lastFrom = c.from;
      lastTo = c.to;
    });

    if (options && Number.isInteger(options.connections)) {
      if (this.connections.length !== options.connections) {
        throw new Error(
          "Connections length: " + this.connections.length +
            " expected: " +
            options.connections,
        );
      }
    }

    return stats;
  }

  selfConnection(indx: number): SynapseInternal | null {
    let results = this.cacheSelf.get(indx);
    if (results === undefined) {
      results = [];
      const tmpList = this.connections;
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

  toConnections(to: number): SynapseInternal[] {
    let results = this.cacheTo.get(to);
    if (results === undefined) {
      results = [];
      const tmpList = this.connections;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];

        if (c.to === to) results.push(c);
      }

      this.cacheTo.set(to, results);
    }
    return results;
  }

  fromConnections(from: number): SynapseInternal[] {
    let results = this.cacheFrom.get(from);
    if (results === undefined) {
      results = [];
      const tmpList = this.connections;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];

        if (c.from === from) results.push(c);
      }

      this.cacheFrom.set(from, results);
    }
    return results;
  }

  getNode(pos: number): Neuron {
    if (Number.isInteger(pos) == false || pos < 0) {
      throw new Error("POS should be a non-negative integer was: " + pos);
    }
    const tmp = this.nodes[pos];

    if (tmp === undefined) {
      throw new Error("getNode( " + pos + ") " + (typeof tmp));
    }

    return tmp;
  }

  getConnection(from: number, to: number): SynapseInternal | null {
    if (Number.isInteger(from) == false || from < 0) {
      throw new Error("FROM should be a non-negative integer was: " + from);
    }

    if (Number.isInteger(to) == false || to < 0) {
      throw new Error("TO should be a non-negative integer was: " + to);
    }

    for (let pos = this.connections.length; pos--;) {
      const c = this.connections[pos];

      if (c.from == from && c.to == to) {
        return c;
      }
    }

    return null;
  }

  /**
   * Connects the from node to the to node
   */
  connect(
    from: number,
    to: number,
    weight: number,
    type?: "positive" | "negative" | "condition",
  ) {
    if (
      Number.isInteger(from) == false || from < 0
    ) {
      throw new Error("from should be a non-negative integer was: " + from);
    }

    if (Number.isInteger(to) == false || to < 0) {
      throw new Error("to should be a non-negative integer was: " + to);
    }

    if (to < this.input) {
      throw new Error(
        "to should not be pointed to any input nodes(" +
          this.input + "): " + to,
      );
    }

    if (to < from) {
      throw new Error("to: " + to + " should not be less than from: " + from);
    }

    if (typeof weight !== "number") {
      if (this.DEBUG) {
        this.DEBUG = false;
        console.warn(
          JSON.stringify(this.exportJSON(), null, 2),
        );

        this.DEBUG = true;
      }

      throw new Error(from + ":" + to + ") weight not a number was: " + weight);
    }

    const connection = new Synapse(
      from,
      to,
      weight,
      type,
    );

    let location = -1;

    for (let indx = this.connections.length; indx--;) {
      const c = this.connections[indx];

      if (c.from < from) {
        location = indx + 1;
        break;
      } else if (c.from === from) {
        if (c.to < to) {
          location = indx + 1;
          break;
        } else if (c.to === to) {
          throw new Error(
            indx + ") already connected from: " + from + " to: " + to,
          );
        } else {
          location = indx;
        }
      } else {
        location = indx;
      }
    }
    if (location !== -1 && location < this.connections.length) {
      const left = this.connections.slice(0, location);
      const right = this.connections.slice(location);

      this.connections = [...left, connection, ...right];
    } else {
      this.connections.push(connection);
    }

    this.clearCache();

    return connection;
  }

  /**
   * Disconnects the from node from the to node
   */
  disconnect(from: number, to: number) {
    if (Number.isInteger(from) == false || from < 0) {
      throw new Error("from should be a non-negative integer was: " + from);
    }
    if (Number.isInteger(to) == false || to < 0) {
      throw new Error("to should be a non-negative integer was: " + to);
    }

    // Delete the connection in the creature's connection array
    const connections = this.connections;

    let found = false;
    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.from === from && connection.to === to) {
        found = true;
        connections.splice(i, 1);
        this.clearCache();

        break;
      }
    }

    if (!found) {
      throw new Error("No connection from: " + from + ", to: " + to);
    }
  }

  applyLearnings(config: BackPropagationConfig) {
    this.propagateUpdate(config);

    const oldConnections = this.connections.length;
    const oldNodes = this.nodes.length;
    let changed = false;
    for (
      let i = this.nodes.length;
      i--;
    ) {
      const n = this.nodes[i];
      if (n.type == "input") break;
      changed ||= n.applyLearnings();
    }

    if (changed) {
      this.fix();
      const temp = this.compact();
      if (temp != null) {
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
    if (
      expected === undefined || expected.length !== this.output
    ) {
      throw new Error(
        `Expected length should match creature's output length: ${this.output} was: ${expected?.length}`,
      );
    }

    const indices = Array.from({ length: this.output }, (_, i) => i); // Create an array of indices

    if (!config.disableRandomSamples) {
      CreatureUtil.shuffle(indices);
    }

    const lastOutputIndx = this.nodes.length - this.output;
    for (let attempts = this.output; attempts--;) {
      // for (let attempts = 12; attempts--;) {
      // Propagate output nodes
      for (
        let i = this.output;
        i--;
      ) {
        const expectedIndex = indices[i];
        const nodeIndex = lastOutputIndx + expectedIndex;

        const n = this.nodes[nodeIndex];

        n.propagate(
          expected[expectedIndex],
          config,
        );
      }
    }
  }

  /**
   * Back propagate the creature
   */
  propagateUpdate(config: BackPropagationConfig) {
    if (this.state.propagated) throw new Error(`Already propagated`);

    for (
      let indx = this.nodes.length - 1;
      indx >= this.input;
      indx--
    ) {
      const n = this.nodes[indx];
      n.propagateUpdate(config);
    }
    this.state.propagated = true;
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
      ? start + Math.max(1, options.timeoutMinutes) * 60_000
      : 0;

    const workers: WorkerHandler[] = [];

    const threads = Math.round(
      Math.max(
        options.threads ? options.threads : navigator.hardwareConcurrency,
        1,
      ),
    );

    for (let i = threads; i--;) {
      workers.push(
        new WorkerHandler(dataSetDir, options.costName ?? "MSE", threads == 1),
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

      const fittestScore = fittest.score ? fittest.score : -Infinity;
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
    if (
      dataSet[0].input.length !== this.input ||
      dataSet[0].output.length !== this.output
    ) {
      throw new Error(
        "Dataset input(" + dataSet[0].input.length + ")/output(" +
          dataSet[0].output.length +
          ") size should be same as creature input(" +
          this.input + ")/output(" + this.output + ") size!",
      );
    }

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
    if (Number.isInteger(index) == false || index < 0) {
      throw new Error("to should be non-negative was: " + index);
    }
    if (!focusList || focusList.length == 0) return true;

    if (checked.has(index)) return false;

    checked.add(index);

    for (let pos = 0; pos < focusList.length; pos++) {
      const focusIndex = focusList[pos];

      if (index == focusIndex) {
        return true;
      }

      const toList = this.toConnections(index);

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

  public subNode(focusList?: number[]) {
    // Check if there are nodes left to remove
    if (this.nodes.length === this.input + this.output) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      // Select a node which isn't an input or output node
      const indx = Math.floor(
        Math.random() *
            (this.nodes.length - this.output - this.input) +
          this.input,
      );

      if (!this.inFocus(indx, focusList)) continue;
      this.removeHiddenNode(indx);
      break;
    }
  }

  /**
   *  Removes a node from the creature
   */
  private removeHiddenNode(indx: number) {
    if (Number.isInteger(indx) == false || indx < 0) {
      throw new Error("Must be a positive integer was: " + indx);
    }

    const node = this.nodes[indx];

    if (node.type !== "hidden" && node.type !== "constant") {
      throw new Error(
        indx + ") Node must be a 'hidden' type was: " + node.type,
      );
    }
    const left = this.nodes.slice(0, indx);
    const right = this.nodes.slice(indx + 1);
    right.forEach((item) => {
      const node = item;
      node.index--;
    });

    const full = [...left, ...right];

    this.nodes = full;

    const tmpConnections: SynapseInternal[] = [];

    this.connections.forEach((c) => {
      if (c.from !== indx) {
        if (c.from > indx) c.from--;
        if (c.to !== indx) {
          if (c.to > indx) c.to--;

          tmpConnections.push(c);
        }
      }
    });

    this.connections = tmpConnections;
    this.clearCache();
  }

  public addNode(focusList?: number[]) {
    const node = new Neuron(crypto.randomUUID(), "hidden", undefined, this);

    // Random squash function
    node.mutate(Mutation.MOD_ACTIVATION.name);

    node.index = Math.floor(
      Math.random() *
        (this.nodes.length - this.output - this.input + 1),
    ) + this.input;

    this._insertNode(node);

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
          Math.random() * node.index,
        );

        if (node.index <= pos || pos < 0) {
          throw new Error(
            `From: ${pos} should be less than node index: ${node.index}`,
          );
        }
        if (this.inFocus(pos, tmpFocusList)) {
          fromIndex = pos;
        }
      } else if (toIndex === -1) {
        const pos = Math.floor(
          Math.random() * (this.nodes.length - node.index),
        ) + node.index;

        if (node.index > pos) {
          throw new Error(
            "To: " + pos + " should be greater than node index: " +
              node.index,
          );
        }

        if (this.inFocus(pos, tmpFocusList)) {
          const toNode = this.getNode(pos);
          if (toNode.type !== "constant") {
            toIndex = pos;
          }
        }
      } else {
        break;
      }
    }

    if (fromIndex !== -1) {
      this.connect(
        fromIndex,
        node.index,
        Synapse.randomWeight(),
      );
    } else {
      console.warn("addNode: Should have a from index");
    }

    if (toIndex !== -1) {
      this.connect(
        node.index,
        toIndex,
        Synapse.randomWeight(),
      );
      node.fix();
      const connection = this.getConnection(node.index, toIndex);
      if (!connection) {
        /* If the self connection was removed */
        const toIndex2 = Math.floor(
          Math.random() * (this.nodes.length - node.index - 1),
        ) + node.index + 1;
        this.connect(
          node.index,
          toIndex2,
          Synapse.randomWeight(),
        );
      }
    } else {
      console.warn("addNode: Should have a to index");
    }
  }

  private _insertNode(node: Neuron) {
    if (
      Number.isInteger(node.index) == false || node.index < this.input
    ) {
      throw new Error(
        "to should be a greater than the input count was: " + node.index,
      );
    }

    const firstOutputIndex = this.nodes.length - this.output;
    if (node.index > firstOutputIndex) {
      throw new Error(
        "to should be a between than input (" + this.input +
          ") and output nodes (" + firstOutputIndex + ") was: " + node.index,
      );
    }

    if (node.type !== "hidden") {
      throw new Error("Should be a 'hidden' type was: " + node.type);
    }
    const left = this.nodes.slice(0, node.index);
    const right = this.nodes.slice(node.index);
    right.forEach((n) => {
      n.index++;
    });

    const full = [...left, node, ...right];

    this.nodes = full;

    this.connections.forEach((c) => {
      if (c.from >= node.index) c.from++;
      if (c.to >= node.index) c.to++;
    });

    this.clearCache();
  }

  public addConnection(focusList?: number[], options = {
    weightScale: 1,
  }) {
    // Create an array of all uncreated (feedforward) connections
    const available = [];

    for (let i = 0; i < this.nodes.length; i++) {
      const node1 = this.nodes[i];

      if (node1.index != i) {
        throw i + ") invalid node index: " + node1.index;
      }

      if (!this.inFocus(i, focusList)) continue;

      for (
        let j = Math.max(i + 1, this.input);
        j < this.nodes.length;
        j++
      ) {
        if (!this.inFocus(j, focusList)) continue;
        const node2 = this.nodes[j];

        if (node2.type === "constant") continue;

        if (!node1.isProjectingTo(node2)) {
          available.push([node1, node2]);
        }
      }
    }

    if (available.length === 0) {
      return;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    const indx0 = pair[0].index;
    const indx1 = pair[1].index;
    const w = Synapse.randomWeight() * options.weightScale
      ? options.weightScale
      : 1;
    this.connect(
      indx0 ? indx0 : 0,
      indx1 ? indx1 : 0,
      w,
    );
  }

  public makeRandomConnection(indx: number) {
    for (let attempts = 0; attempts < 12; attempts++) {
      const from = Math.min(
        this.nodes.length - this.output - 1,
        Math.floor(Math.random() * indx + 1),
      );
      const c = this.getConnection(from, indx);
      if (c === null) {
        return this.connect(
          from,
          indx,
          Synapse.randomWeight(),
        );
      }
    }
    const firstOutputIndex = this.nodes.length - this.output;
    for (let from = 0; from <= indx; from++) {
      if (from >= firstOutputIndex && from !== indx) continue;
      const c = this.getConnection(from, indx);
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

    for (let i = 0; i < this.connections.length; i++) {
      const conn = this.connections[i];
      // Check if it is not disabling a node
      if (
        conn.to > conn.from
      ) {
        if (
          this.inFocus(conn.to, focusList) || this.inFocus(conn.from, focusList)
        ) {
          /** Each node must have at least one from/to connection */
          if (
            (
              this.fromConnections(conn.from).length > 1 ||
              this.nodes[conn.from].type === "input"
            ) && this.toConnections(conn.to).length > 1
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
    const allConnections = this.connections.filter(
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
        Math.random() * (this.nodes.length - this.input) +
          this.input,
      );
      const node = this.nodes[index];
      if (node.type === "constant") continue;
      if (!this.inFocus(index, focusList) && attempts < 6) continue;
      node.mutate(Mutation.MOD_BIAS.name);
      break;
    }
  }

  private modActivation(focusList?: number[]) {
    for (let attempts = 0; attempts < 12; attempts++) {
      const index = Math.floor(
        Math.random() * (
              this.nodes.length -
              this.input
            ) + this.input,
      );
      const node = this.nodes[index];

      if (node.type == "constant") continue;

      if (this.inFocus(index, focusList)) {
        node.mutate(Mutation.MOD_ACTIVATION.name);
        break;
      }
    }
  }

  private addSelfCon(focusList?: number[]) {
    // Check which nodes aren't self connected yet
    const possible = [];
    for (
      let i = this.input;
      i < this.nodes.length - this.output;
      i++
    ) {
      if (this.inFocus(i, focusList)) {
        const node = this.nodes[i];
        if (node.type === "constant") continue;

        const c = this.selfConnection(node.index);
        if (c === null) {
          possible.push(node);
        }
      }
    }

    if (possible.length === 0) {
      return;
    }

    // Select a random node
    const node = possible[Math.floor(Math.random() * possible.length)];

    // Connect it to himself
    const indx = node.index;
    this.connect(indx, indx, Synapse.randomWeight());
  }

  private subSelfCon(focusList?: number[]) {
    // Check which nodes aren't self connected yet
    const possible = [];
    for (let i = this.input; i < this.nodes.length; i++) {
      if (this.inFocus(i, focusList)) {
        const node = this.nodes[i];
        const indx = node.index;
        const c = this.getConnection(indx, indx);
        if (c !== null) {
          possible.push(node);
        }
      }
    }

    if (possible.length === 0) {
      return;
    }

    // Select a random node
    const node = possible[Math.floor(Math.random() * possible.length)];

    // Connect it to himself
    const indx = node.index;
    this.disconnect(indx, indx);
  }

  private addBackConn(focusList?: number[]) {
    // Create an array of all uncreated (back feed) connections
    const available = [];
    for (let i = this.input; i < this.nodes.length; i++) {
      if (this.inFocus(i, focusList)) {
        const node1 = this.nodes[i];
        for (let j = this.input; j < i; j++) {
          const node2 = this.nodes[j];
          if (node2.type == "output") break;
          if (this.inFocus(node2.index, focusList)) {
            if (!node2.isProjectingTo(node1)) {
              available.push([node2, node1]);
            }
          }
        }
      }
    }

    if (available.length === 0) {
      return;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    const indx0 = pair[0].index;
    const indx1 = pair[1].index;
    this.connect(indx0, indx1, Synapse.randomWeight());
  }

  private subBackConn(focusList?: number[]) {
    // Create an array of all uncreated (back fed) connections
    const available = [];
    for (let to = this.input; to < this.nodes.length; to++) {
      if (this.inFocus(to, focusList)) {
        for (let from = 0; from < to; from++) {
          if (this.inFocus(from, focusList)) {
            if (
              (
                this.fromConnections(from).length > 1 ||
                this.nodes[from].type === "input"
              ) && this.toConnections(to).length > 1
            ) {
              if (this.getConnection(from, to) != null) {
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
      (this.nodes.length - this.input < 2) ||
      (this.nodes.length - this.input - this.output < 2)
    ) {
      return;
    }

    let node1 = null;
    for (let attempts = 0; attempts < 12; attempts++) {
      const index1 = Math.floor(
        Math.random() *
            (this.nodes.length -
              this.input - this.output) + this.input,
      );

      if (this.inFocus(index1, focusList)) {
        const tmpNode = this.nodes[index1];
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
            (this.nodes.length -
              this.input - this.output) + this.input,
      );

      if (this.inFocus(index2, focusList)) {
        const tmpNode = this.nodes[index2];
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
      if (this.DEBUG) this.validate();
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
        this.addNode(focusList);
        break;
      }
      case Mutation.SUB_NODE.name: {
        this.subNode(focusList);

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
      this.validate();
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
    const maxTo = this.nodes.length - 1;
    const minTo = this.input;

    const connections: Synapse[] = [];
    this.connections.forEach((c) => {
      if (c.to > maxTo) {
        console.debug("Ignoring connection to above max", maxTo, c);
      } else if (c.to < minTo) {
        console.debug("Ignoring connection to below min", minTo, c);
      } else {
        connections.push(c as Synapse);
      }
    });

    this.connections = connections;
    this.clearCache();

    let nodeRemoved = true;

    while (nodeRemoved) {
      nodeRemoved = false;
      for (
        let pos = this.input;
        pos < this.nodes.length - this.output;
        pos++
      ) {
        if (this.nodes[pos].type == "output") continue;
        if (
          this.fromConnections(pos).filter((c) => {
            return c.from !== c.to;
          }).length == 0
        ) {
          this.removeHiddenNode(pos);
          nodeRemoved = true;
          break;
        }
      }
    }

    this.nodes.forEach((node) => {
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
    return this.nodes.length;
  }

  /**
   * Convert the creature to a json object
   */
  exportJSON() {
    if (this.DEBUG) {
      this.validate();
    }

    const json: CreatureExport = {
      nodes: new Array<NeuronExport>(
        this.nodes.length - this.input,
      ),
      connections: new Array<SynapseExport>(this.connections.length),
      input: this.input,
      output: this.output,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    const uuidMap = new Map<number, string>();
    for (let i = this.nodes.length; i--;) {
      const node = this.nodes[i];
      uuidMap.set(i, node.uuid ? node.uuid : `unknown-${i}`);
      if (node.type == "input") continue;

      const tojson = node.exportJSON();

      json.nodes[i - this.input] = tojson;
    }

    for (let i = this.connections.length; i--;) {
      const exportJSON = (this.connections[i] as Synapse).exportJSON(
        uuidMap,
      );

      json.connections[i] = exportJSON;
    }

    return json;
  }

  traceJSON(): CreatureTrace {
    const json = this.exportJSON();

    const traceNodes = Array<NeuronTrace>(json.nodes.length);
    let exportIndex = 0;
    this.nodes.forEach((n) => {
      if (n.type !== "input") {
        const indx = n.index;
        const ns = this.state.node(indx);

        const traceNode: NeuronExport = json.nodes[exportIndex] as NeuronTrace;

        (traceNode as NeuronTrace).trace = ns;
        traceNodes[exportIndex] = traceNode as NeuronTrace;
        exportIndex++;
      }
    });
    json.nodes = traceNodes;
    const traceConnections = Array<SynapseTrace>(json.connections.length);
    this.connections.forEach((c, indx) => {
      const exportConnection = json.connections[indx] as SynapseTrace;
      const cs = this.state.connection(c.from, c.to);
      exportConnection.trace = cs;

      traceConnections[indx] = exportConnection;
    });
    json.connections = traceConnections;

    return json as CreatureTrace;
  }

  internalJSON() {
    if (this.DEBUG) {
      this.validate();
    }

    const json: CreatureInternal = {
      uuid: this.uuid,
      nodes: new Array<NeuronInternal>(
        this.nodes.length - this.input,
      ),
      connections: new Array<SynapseInternal>(this.connections.length),
      input: this.input,
      output: this.output,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    for (let i = this.nodes.length; i--;) {
      const node = this.nodes[i];

      if (node.type == "input") continue;

      const tojson = node.internalJSON(i);

      json.nodes[i - this.input] = tojson;
    }

    for (let i = this.connections.length; i--;) {
      const internalJSON = (this.connections[i] as Synapse).internalJSON();

      json.connections[i] = internalJSON;
    }

    return json;
  }

  loadFrom(json: CreatureInternal | CreatureExport, validate: boolean) {
    this.uuid = (json as CreatureInternal).uuid;
    this.nodes.length = json.nodes.length;
    if (json.tags) {
      this.tags = [...json.tags];
    }

    this.clearState();

    const uuidMap = new Map<string, number>();
    this.nodes = new Array(json.nodes.length);
    for (let i = json.input; i--;) {
      const key = `input-${i}`;
      uuidMap.set(key, i);
      const n = new Neuron(key, "input", undefined, this);
      n.index = i;
      this.nodes[i] = n;
    }

    let pos = json.input;
    let outputIndx = 0;
    for (let i = 0; i < json.nodes.length; i++) {
      const jn = json.nodes[i];

      if ((jn as NeuronInternal).type === "input") continue;
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
        const trace: NeuronState = (jn as NeuronTrace).trace;
        const ns = this.state.node(n.index);
        Object.assign(ns, trace);
      }

      uuidMap.set(n.uuid, pos);

      this.nodes[pos] = n;
      pos++;
    }

    this.connections.length = 0;
    const cLen = json.connections.length;
    for (let i = 0; i < cLen; i++) {
      const conn = json.connections[i];

      const from = (conn as SynapseExport).fromUUID
        ? uuidMap.get((conn as SynapseExport).fromUUID)
        : (conn as SynapseInternal).from;
      const to = (conn as SynapseExport).toUUID
        ? uuidMap.get((conn as SynapseExport).toUUID)
        : (conn as SynapseInternal).to;
      const connection = this.connect(
        from ? from : 0,
        to ? to : 0,
        conn.weight,
        conn.type,
      );
      if ((conn as SynapseTrace).trace) {
        const cs = this.state.connection(connection.from, connection.to);
        const trace = (conn as SynapseTrace).trace;
        Object.assign(cs, trace);
      }
    }

    this.clearCache();

    if (validate) {
      this.validate();
    }
  }

  /**
   * Convert a json object to a creature
   */
  static fromJSON(json: CreatureInternal | CreatureExport, validate = false) {
    const creature = new Creature(json.input, json.output, {
      lazyInitialization: true,
    });
    creature.loadFrom(json, validate);

    return creature;
  }
}
