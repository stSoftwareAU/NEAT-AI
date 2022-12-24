import { TagInterface } from "../tags/TagInterface.ts";
import { ConnectionInterface } from "./ConnectionInterface.ts";
import { NodeInterface } from "./NodeInterface.ts";
import { NetworkInterface } from "./NetworkInterface.ts";

import { DataRecordInterface } from "./DataSet.ts";
import { make as makeConfig } from "../config/NeatConfig.ts";
import { NeatOptions } from "../config/NeatOptions.ts";

import { yellow } from "https://deno.land/std@0.170.0/fmt/colors.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { Neat } from "../Neat.ts";
import { getTag } from "../tags/TagsInterface.ts";
import { makeDataDir } from "../architecture/DataSet.ts";

import { TrainOptions } from "../config/TrainOptions.ts";
import { findRatePolicy, randomPolicyName } from "../config.ts";
import { emptyDirSync } from "https://deno.land/std@0.170.0/fs/empty_dir.ts";
import { Mutation } from "../methods/mutation.ts";
import { Node } from "../architecture/Node.ts";
import { Connection } from "./Connection.ts";
import { LOGISTIC } from "../methods/activations/types/LOGISTIC.ts";
import { NetworkState } from "./NetworkState.ts";
import { CostInterface, Costs } from "../Costs.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { addTag } from "../tags/TagsInterface.ts";

const cacheDataFile = {
  fn: "",
  json: {},
};

export class Network implements NetworkInterface {
  /* ID of this network */
  uuid?: string;

  input: number;
  output: number;
  nodes: NodeInterface[];
  tags?: TagInterface[];
  score?: number;
  connections: ConnectionInterface[];

  readonly networkState = new NetworkState();
  private cache = new Map<string, ConnectionInterface[]>();
  DEBUG = ((globalThis as unknown) as { DEBUG: boolean }).DEBUG;

  constructor(input: number, output: number, options = {}) {
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

    if (options) {
      this.initialize(options);

      if (this.DEBUG) {
        this.validate();
      }
    }
  }

  /* Dispose of the network and all held memory */
  public dispose() {
    this.clear();
    this.clearCache();
    this.connections = [];
    this.nodes = [];
  }

  public clearCache() {
    this.cache.clear();
  }

  initialize(options: {
    layers?: { squash: string; count: number }[];
  }) {
    let fixNeeded = false;
    // Create input nodes
    for (let i = this.input; i--;) {
      const type = "input";
      const node = new Node(`input-${i}`, type, 0, this);
      node.index = this.nodes.length;
      this.nodes.push(node);
    }

    if (options.layers) {
      let lastStartIndx = 0;
      let lastEndIndx = this.nodes.length - 1;

      for (let i = 0; i < options.layers.length; i++) {
        const layer = options.layers[i];

        if (layer.count <= 0) {
          throw "Layer count should be positive was: " + layer.count;
        }
        for (let j = 0; j < layer.count; j++) {
          let tmpSquash = layer.squash ? layer.squash : LOGISTIC.NAME;
          if (tmpSquash == "*") {
            tmpSquash = Activations
              .NAMES[Math.floor(Activations.NAMES.length * Math.random())];
            fixNeeded = true;
          }

          const node = new Node(
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
            this.connect(k, l, Connection.randomWeight());
          }
        }
        this.output = tmpOutput;
        lastStartIndx = lastEndIndx + 1;
        lastEndIndx = this.nodes.length - 1;
      }

      // Create output nodes
      for (let i = this.output; i--;) {
        const type = "output";
        const node = new Node(
          crypto.randomUUID(),
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
          this.connect(k, l, Connection.randomWeight());
        }
      }
    } else {
      // Create output nodes
      for (let i = this.output; i--;) {
        const type = "output";
        const node = new Node(
          crypto.randomUUID(),
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
   * Clear the context of the network
   */
  clear() {
    this.networkState.clear();
  }

  /**
   * Activates the network
   */
  activate(input: number[], feedbackLoop = false) {
    if (input && input.length != this.input) {
      console.trace();
      throw "Activate input: " + input.length +
        " does not match expected input: " + this.input;
    }
    if (!feedbackLoop) {
      this.networkState.clear();
    }
    const output: number[] = new Array(this.output);
    const ns = this.networkState;
    for (let i = this.input; i--;) {
      ns.node(i).activation = input[i];
    }

    const lastHiddenNode = this.nodes.length - this.output;

    /* Activate nodes chronologically */
    for (let i = this.input; i < lastHiddenNode; i++) {
      (this.nodes[i] as Node).activate();
    }

    for (let i = 0; i < this.output; i++) {
      output[i] = (this.nodes[i + lastHiddenNode] as Node).activate();
    }

    return output;
  }

  /**
   * Activates the network without calculating eligibility traces and such
   */
  noTraceActivate(input: number[], feedbackLoop = false) {
    if (!feedbackLoop) {
      this.networkState.clear();
    }
    const output: number[] = new Array(this.output);
    const ns = this.networkState;
    for (let i = this.input; i--;) {
      ns.node(i).activation = input[i];
    }

    const lastHiddenNode = this.nodes.length - this.output;

    /* Activate nodes chronologically */
    for (let i = this.input; i < lastHiddenNode; i++) {
      (this.nodes[i] as Node).noTraceActivate();
    }

    for (let i = 0; i < this.output; i++) {
      output[i] = (this.nodes[i + lastHiddenNode] as Node)
        .noTraceActivate();
    }

    return output;
  }

  /**
   * Compact the network.
   */
  compact(): Network | null {
    const holdDebug = this.DEBUG;
    this.DEBUG = false;
    const json = this.toJSON();
    this.DEBUG = holdDebug;
    const compactNetwork = Network.fromJSON(json);
    compactNetwork.fix();

    let complete = false;
    for (let changes = 0; complete == false; changes++) {
      complete = true;
      for (
        let pos = compactNetwork.input;
        pos < compactNetwork.nodes.length - compactNetwork.output;
        pos++
      ) {
        const fromList = compactNetwork.fromConnections(pos).filter(
          (c: ConnectionInterface) => {
            return c.from !== c.to;
          },
        );

        if (fromList.length == 0) {
          compactNetwork.removeHiddenNode(pos);
          complete = false;
        } else {
          const toList = compactNetwork.toConnections(pos).filter(
            (c: ConnectionInterface) => {
              return c.from !== c.to;
            },
          );
          if (toList.length == 1) {
            const fromList = compactNetwork.fromConnections(pos).filter(
              (c: ConnectionInterface) => {
                return c.from !== c.to;
              },
            );
            if (fromList.length == 1) {
              const to = fromList[0].to;
              const from = toList[0].from;
              if (
                from > this.input &&
                compactNetwork.nodes[from].type ==
                  compactNetwork.nodes[pos].type
              ) {
                if (compactNetwork.getConnection(from, to) == null) {
                  let weightA = fromList[0].weight * toList[0].weight;

                  const tmpFromBias = compactNetwork.nodes[from].bias;
                  const tmpToBias = compactNetwork.nodes[pos].bias;
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

                  compactNetwork.nodes[from].bias = biasA;

                  compactNetwork.removeHiddenNode(pos);
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

                  compactNetwork.connect(
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

    const json2 = compactNetwork.toJSON();
    if (JSON.stringify(json, null, 2) != JSON.stringify(json2, null, 2)) {
      addTag(compactNetwork, "approach", "compact");
      addTag(compactNetwork, "old-nodes", this.nodes.length.toString());
      addTag(
        compactNetwork,
        "old-connections",
        this.connections.length.toString(),
      );

      return compactNetwork;
    } else {
      return null;
    }
  }

  /**
   * Validate the network
   * @param options specific values to check
   */
  validate(options?: { nodes?: number; connections?: number }) {
    if (options && options.nodes) {
      if (this.nodes.length !== options.nodes) {
        throw "Node length: " + this.nodes.length + " expected: " +
          options.nodes;
      }
    }

    if (
      Number.isInteger(this.input) == false || this.input < 1
    ) {
      console.trace();
      throw "Must have at least one input nodes was: " + this.input;
    }

    if (
      Number.isInteger(this.output) == false || this.output < 1
    ) {
      console.trace();
      throw "Must have at least one output nodes was: " + this.output;
    }

    const stats = {
      input: 0,
      constant: 0,
      hidden: 0,
      output: 0,
      connections: 0,
    };

    this.nodes.forEach((node, indx) => {
      if (node.squash === "IF" && indx > 2) {
        const toList = this.toConnections(indx);
        if (toList.length < 3) {
          console.trace();
          throw indx + ") 'IF' should have at least 3 connections was: " +
            toList.length;
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
          console.trace();
          if (this.DEBUG) {
            this.DEBUG = false;
            console.warn(
              JSON.stringify(this.toJSON(), null, 2),
            );
            this.DEBUG = true;
          }
        }
        if (!foundCondition) throw indx + ") 'IF' should have a condition(s)";
        if (!foundPositive) {
          throw indx + ") 'IF' should have a positive connection(s)";
        }
        if (!foundNegative) {
          throw indx + ") 'IF' should have a negative connection(s)";
        }
      }
      switch (node.type) {
        case "input": {
          stats.input++;
          const toList = this.toConnections(indx);
          if (toList.length > 0) {
            console.trace();

            console.info(this.connections);
            throw indx + ") 'input' node has inward connections: " +
              toList.length;
          }
          break;
        }
        case "constant": {
          stats.constant++;
          const toList = this.toConnections(indx);
          if (toList.length > 0) {
            console.trace();

            console.info(this.connections);
            throw indx + ") '" + node.type + "' node has inward connections: " +
              toList.length;
          }
          if (node.squash) {
            throw indx + ") '" + node.type + "' has squash: " +
              node.squash;
          }
          break;
        }
        case "hidden": {
          stats.hidden++;
          const toList = this.toConnections(indx);
          if (toList.length == 0) {
            console.trace();
            console.info(this.connections);
            throw indx + ") hidden node has no inward connections";
          }
          const fromList = this.fromConnections(indx);
          if (fromList.length == 0) {
            const gateList = this.gateConnections(indx);
            if (gateList.length == 0) {
              console.trace();
              throw indx + ") hidden node has no outward or gate connections";
            }
          }
          if (typeof node.bias === "undefined") {
            console.trace();
            throw indx + ") hidden node should have a bias was: " + node.bias;
          }
          if (!Number.isFinite(node.bias)) {
            console.trace();
            throw indx + ") hidden node should have a finite bias was: " +
              node.bias;
          }

          break;
        }
        case "output": {
          stats.output++;
          const toList = this.toConnections(indx);
          if (toList.length == 0) {
            console.trace();
            if (this.DEBUG) {
              this.DEBUG = false;
              console.warn(
                JSON.stringify(
                  this.toJSON(),
                  null,
                  2,
                ),
              );
              this.DEBUG = true;
            }
            throw indx + ") output node has no inward connections";
          }
          break;
        }
        default:
          throw indx + ") Invalid type: " + node.type;
      }

      if (node.index !== indx) {
        console.trace();
        throw indx + ") node.index: " + node.index +
          " does not match expected index";
      }
      if ((node as Node).network !== this) {
        console.trace();
        throw indx + ") node.network mismatch";
      }
    });

    if (stats.input !== this.input) {
      console.trace();
      throw "Expected " + this.input + " input nodes found: " +
        stats.input;
    }
    if (stats.output !== this.output) {
      console.trace();
      throw "Expected " + this.output + " output nodes found: " +
        stats.output;
    }

    let lastFrom = -1;
    let lastTo = -1;
    this.connections.forEach((c, indx) => {
      stats.connections++;
      const toNode = this.getNode(c.to);

      if (toNode.type === "input") {
        console.info(JSON.stringify(this.connections, null, 1));
        console.trace();
        throw indx + ") connection points to an input node";
      }
      const fromNode = this.getNode(c.from);

      if (fromNode.type === "output") {
        if (c.from != c.to) {
          console.trace();
          throw indx + ") connection from an output node";
        }
      }

      if (Number.isInteger(c.gater)) {
        const gaterNode = this.getNode(c.gater as number);

        if (gaterNode.type === "input") {
          throw indx + ") connection can't be gated by input";
        }
      }
      if (c.from < lastFrom) {
        console.info(JSON.stringify(this.connections, null, 1));
        console.trace();
        throw indx + ") connections not sorted";
      } else if (c.from > lastFrom) {
        lastTo = -1;
      }

      if (c.from == lastFrom && c.to <= lastTo) {
        console.info(JSON.stringify(this.connections, null, 1));
        console.trace();
        throw indx + ") connections not sorted";
      }

      lastFrom = c.from;
      lastTo = c.to;
    });

    if (options && Number.isInteger(options.connections)) {
      if (this.connections.length !== options.connections) {
        console.trace();
        throw "Connections length: " + this.connections.length +
          " expected: " +
          options.connections;
      }
    }

    return stats;
  }

  selfConnection(indx: number): ConnectionInterface | null {
    const key = "self:" + indx;
    let results = this.cache.get(key);
    if (results === undefined) {
      results = [];
      const tmpList = this.connections;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];
        if (c.to === indx && c.from == indx) {
          results.push(c);
        }
      }

      this.cache.set(key, results);
    }

    if (results.length > 0) {
      return results[0];
    } else {
      return null;
    }
  }

  toConnections(to: number): ConnectionInterface[] {
    const key = "to:" + to;
    let results = this.cache.get(key);
    if (results === undefined) {
      results = [];
      const tmpList = this.connections;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];

        if (c.to === to) results.push(c);
      }

      this.cache.set(key, results);
    }
    return results;
  }

  fromConnections(from: number): ConnectionInterface[] {
    const key = "from:" + from;
    let results = this.cache.get(key);
    if (results === undefined) {
      results = [];
      const tmpList = this.connections;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];

        if (c.from === from) results.push(c);
      }

      this.cache.set(key, results);
    }
    return results;
  }

  gates(): ConnectionInterface[] {
    const key = "gates";
    let results = this.cache.get(key);
    if (results === undefined) {
      results = [];
      const tmpList = this.connections;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];

        if (c.gater !== undefined) results.push(c);
      }

      this.cache.set(key, results);
    }
    return results;
  }

  gateConnections(indx: number): ConnectionInterface[] {
    const key = "gate:" + indx;
    let results = this.cache.get(key);
    if (results === undefined) {
      results = [];
      const tmpList = this.connections;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];

        if (c.gater === indx) results.push(c);
      }

      this.cache.set(key, results);
    }
    return results;
  }

  getNode(pos: number): Node {
    if (Number.isInteger(pos) == false || pos < 0) {
      console.trace();
      throw "POS should be a non-negative integer was: " + pos;
    }
    const tmp = this.nodes[pos];

    if (typeof tmp === "undefined") {
      console.trace();
      throw "getNode( " + pos + ") " + (typeof tmp);
    }

    tmp.index = pos;

    return ((tmp as unknown) as Node);
  }

  getConnection(from: number, to: number): ConnectionInterface | null {
    if (Number.isInteger(from) == false || from < 0) {
      console.trace();
      throw "FROM should be a non-negative integer was: " + from;
    }

    if (Number.isInteger(to) == false || to < 0) {
      console.trace();
      throw "TO should be a non-negative integer was: " + to;
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
      console.trace();
      throw "from should be a non-negative integer was: " + from;
    }

    if (Number.isInteger(to) == false || to < 0) {
      console.trace();
      throw "to should be a non-negative integer was: " + to;
    }

    const firstOutputIndex = this.nodes.length - this.output;
    if (from >= firstOutputIndex && from !== to) {
      console.trace();
      throw "from should not be from an output node (" + firstOutputIndex +
        ", len: " + this.nodes.length + ", output: " +
        this.output +
        "): " + from;
    }

    if (to < this.input) {
      console.trace();
      throw "to should not be pointed to any input nodes(" +
        this.input + "): " + to;
    }

    if (to < from) {
      console.trace();
      throw "to: " + to + " should not be less than from: " + from;
    }

    if (typeof weight !== "number") {
      if (this.DEBUG) {
        this.DEBUG = false;
        console.warn(
          JSON.stringify(this.toJSON(), null, 2),
        );

        this.DEBUG = true;
      }
      console.trace();
      throw from + ":" + to + ") weight not a number was: " + weight;
    }

    const connection = new Connection(
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
          console.trace();

          throw indx + ") already connected from: " + from + " to: " + to;
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
      console.trace();
      throw "from should be a non-negative integer was: " + from;
    }
    if (Number.isInteger(to) == false || to < 0) {
      console.trace();
      throw "to should be a non-negative integer was: " + to;
    }

    // Delete the connection in the network's connection array
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
      console.trace();
      throw "No connection from: " + from + ", to: " + to;
    }
  }

  applyLearnings() {
    const oldConnections = this.connections.length;
    const oldNodes = this.nodes.length;
    let changed = false;
    for (
      let i = this.nodes.length;
      i--;
    ) {
      const n = (this.nodes[i] as Node);
      if (n.type == "input") break;
      changed ||= n.applyLearnings();
    }

    if (changed) {
      this.fix();
      const temp = this.compact();
      if (temp != null) {
        this.loadFrom(temp.toJSON(), true);
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
   * Back propagate the network
   */
  propagate(rate: number, momentum: number, update: boolean, target: number[]) {
    if (
      target === undefined || target.length !== this.output
    ) {
      throw new Error(
        "Output target length should match network output length",
      );
    }

    let targetIndex = target.length;

    // Propagate output nodes
    for (
      let i = this.nodes.length - 1;
      i >= this.nodes.length - this.output;
      i--
    ) {
      const n = (this.nodes[i] as Node);
      n.propagate(
        rate,
        momentum,
        update,
        target[--targetIndex],
      );
    }

    // Propagate hidden and input nodes
    for (
      let i = this.nodes.length - this.output - 1;
      i >= this.input;
      i--
    ) {
      const n = (this.nodes[i] as Node);
      n.propagate(rate, momentum, update);
    }
  }

  /**
   * Evolves the network to reach a lower error on a dataset
   */
  async evolveDir(
    dataSetDir: string,
    options: NeatOptions,
  ) {
    const config = makeConfig(options);
    // Read the options

    const start = Date.now();

    const endTimeMS = config.timeoutMinutes
      ? start + Math.max(1, config.timeoutMinutes) * 60_000
      : 0;

    const workers: WorkerHandler[] = [];

    for (let i = config.threads; i--;) {
      workers.push(
        new WorkerHandler(dataSetDir, config.costName, config.threads == 1),
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
    let bestCreature = null;

    let iterationStartMS = new Date().getTime();
    let generation = 0;
    while (
      error > config.targetError &&
      (!options.iterations || generation < options.iterations)
    ) {
      const fittest: Network = await neat.evolve(
        bestCreature as (NetworkInterface | undefined),
      );

      if (fittest.score ? fittest.score : 0 > bestScore) {
        const errorTmp = getTag(fittest, "error");
        if (errorTmp) {
          error = Number.parseFloat(errorTmp);
        } else {
          throw "No error: " + errorTmp;
        }

        bestScore = fittest.score ? fittest.score : 0;
        bestCreature = Network.fromJSON(fittest.toJSON());
      } else if (fittest.score ? fittest.score : 0 < bestScore) {
        throw "fitness decreased over generations";
      }
      const timedOut = endTimeMS ? Date.now() > endTimeMS : false;

      if (
        options.log &&
        (generation % options.log === 0 || timedOut ||
          error <= config.targetError)
      ) {
        const now = new Date().getTime();
        console.log(
          "iteration",
          generation,
          "score",
          fittest.score,
          "error",
          error,
          "avg time",
          yellow(
            new Intl.NumberFormat().format(
              Math.round((now - iterationStartMS) / options.log),
            ) + " ms",
          ),
        );

        iterationStartMS = new Date().getTime();
      }

      if (timedOut) break;
      generation++;
    }

    const promises: Promise<string>[] = [];
    for (let i = workers.length; i--;) {
      const w = workers[i];
      if (w.isBusy()) {
        const p = new Promise<string>((resolve) => {
          w.addIdleListener((w) => {
            w.terminate();
            resolve("done");
          });
        });
        promises.push(p);
      } else {
        w.terminate();
      }
    }
    workers.length = 0; // Release the memory.
    await Promise.all(promises);
    if (bestCreature) {
      this.loadFrom(bestCreature, config.debug);
    }

    if (config.creatureStore) {
      this.writeCreatures(neat, config.creatureStore);
    }
    return {
      error: error,
      score: bestScore,
      time: Date.now() - start,
    };
  }

  /**
   * Evolves the network to reach a lower error on a dataset
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
          dataSet[0].output.length + ") size should be same as network input(" +
          this.input + ")/output(" + this.output + ") size!",
      );
    }

    const config = makeConfig(options);
    const dataSetDir = makeDataDir(dataSet, config.dataSetPartitionBreak);

    const result = await this.evolveDir(dataSetDir, options);

    Deno.removeSync(dataSetDir, { recursive: true });

    return result;
  }

  private dataFiles(dataDir: string) {
    const files: string[] = [];

    if (cacheDataFile.fn.startsWith(dataDir)) {
      files.push(
        cacheDataFile.fn.substring(cacheDataFile.fn.lastIndexOf("/") + 1),
      );
    } else {
      cacheDataFile.fn = "NOT-CACHED";
      for (const dirEntry of Deno.readDirSync(dataDir)) {
        if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
          files.push(dirEntry.name);
        }
      }

      files.sort();
    }

    return files;
  }

  /**
   * Tests a set and returns the error and elapsed time
   */
  testDir(
    dataDir: string,
    cost: CostInterface,
    feedbackLoop: boolean,
  ) {
    let error = 0;
    let counter = 0;

    const files: string[] = this.dataFiles(dataDir).map((fn) =>
      dataDir + "/" + fn
    );

    const cached = files.length == 1;
    if (!cached) {
      cacheDataFile.fn = "";
      cacheDataFile.json = {};
    }
    const EMPTY = { input: [], output: [] };
    for (let j = files.length; j--;) {
      const fn = files[j];

      const json = cacheDataFile.fn == fn
        ? cacheDataFile.json
        : JSON.parse(Deno.readTextFileSync(fn));

      if (cached) {
        cacheDataFile.fn = fn;
        cacheDataFile.json = json;
      }

      if (json.length == 0) {
        throw "Set size must be positive";
      }

      for (let i = json.length; i--;) {
        const data = json[i];

        if (!cached) {
          json[i] = EMPTY;
        }
        const output = this.noTraceActivate(
          data.input,
          feedbackLoop,
        );
        error += cost.calculate(data.output, output);
      }

      counter += json.length;
    }

    const avgError = error / counter;
    const results = {
      error: avgError,
    };

    return results;
  }

  /**
   * Train the given set to this network
   */
  trainDir(
    dataDir: string,
    options: TrainOptions,
  ) {
    options = options || {};
    // Warning messages
    if (options.iterations == undefined) {
      console.warn(
        "No target iterations given, running until error is reached!",
      );
    }

    // Read the options
    const targetError = options.error || 0.05;
    const cost = Costs.find(options.cost ? options.cost : "MSE");
    const baseRate = options.rate == undefined ? Math.random() : options.rate;
    const momentum = options.momentum == undefined
      ? Math.random()
      : options.momentum;
    const batchSize = options.batchSize || 1; // online learning
    const ratePolicyName = options.ratePolicy
      ? options.ratePolicy
      : randomPolicyName();
    const ratePolicy = findRatePolicy(ratePolicyName);

    const iterations = options.iterations ? options.iterations : 0;

    const files: string[] = this.dataFiles(dataDir).map((fn) =>
      dataDir + "/" + fn
    );

    // Loops the training process
    let iteration = 0;
    let error = 1;
    const EMPTY = { input: [], output: [] };
    while (
      Number.isFinite(error) &&
      error > targetError &&
      (iterations === 0 || iteration < iterations)
    ) {
      iteration++;

      // Update the rate
      const currentRate = ratePolicy(baseRate, iteration);

      if (!Number.isFinite(currentRate)) {
        throw "not a valid rate: " + currentRate;
      }

      let counter = 0;
      let errorSum = 0;
      const cached = files.length == 1;
      if (!cached) {
        cacheDataFile.fn = "";
        cacheDataFile.json = {};
      }

      for (let j = files.length; j--;) {
        const fn = files[j];
        const json = cacheDataFile.fn == fn
          ? cacheDataFile.json
          : JSON.parse(Deno.readTextFileSync(fn));

        if (cached) {
          cacheDataFile.fn = fn;
          cacheDataFile.json = json;
        }

        if (json.length == 0) {
          throw "Set size must be positive";
        }
        const len = json.length;

        for (let i = len; i--;) {
          const data = json[i];

          if (!cached) {
            /* Not cached so we can release memory as we go */
            json[i] = EMPTY;
          }
          const update = ((i + 1) % batchSize === 0 || i === 0);

          const output = this.activate(data.input);

          errorSum += cost.calculate(data.output, output);

          this.propagate(currentRate, momentum, update, data.output);
        }

        counter += len;
      }
      this.applyLearnings();
      error = errorSum / counter;

      if (
        options.log && (
          iteration % options.log === 0 ||
          iteration === iterations
        )
      ) {
        console.log(
          "iteration",
          iteration,
          "error",
          error,
          "rate",
          currentRate,
          "clear",
          options.clear ? true : false,
          "policy",
          yellow(ratePolicyName),
          "momentum",
          momentum,
        );
      }
    }

    if (options.clear) this.clear();

    return {
      error: error,
    };
  }

  /**
   * Train the given set to this network
   */
  train(
    dataSet: DataRecordInterface[],
    options: TrainOptions,
  ) {
    if (
      dataSet[0].input.length !== this.input ||
      dataSet[0].output.length !== this.output
    ) {
      throw new Error(
        "Dataset input/output size should be same as network input/output size!",
      );
    }
    const config = makeConfig(options);
    const dataSetDir = makeDataDir(dataSet, config.dataSetPartitionBreak);

    const result = this.trainDir(dataSetDir, options);

    Deno.removeSync(dataSetDir, { recursive: true });

    return result;
  }

  private writeCreatures(neat: Neat, dir: string) {
    let counter = 1;
    emptyDirSync(dir);
    neat.population.forEach((creature: NetworkInterface) => {
      const json = (creature as Network).toJSON();

      const txt = JSON.stringify(json, null, 1);

      const filePath = dir + "/" + counter + ".json";
      Deno.writeTextFileSync(filePath, txt);

      counter++;
    });
  }

  inFocus(index: number, focusList?: number[], checked = new Set()) {
    if (Number.isInteger(index) == false || index < 0) {
      console.trace();
      throw "to should be non-negative was: " + index;
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
      // const node = network.nodes[index];
      if (!this.inFocus(indx, focusList)) continue;
      this.removeHiddenNode(indx);
      break;
    }
  }

  /**
   *  Removes a node from the network
   */
  private removeHiddenNode(indx: number) {
    if (Number.isInteger(indx) == false || indx < 0) {
      console.trace();
      throw "Must be a positive integer was: " + indx;
    }

    const node = this.nodes[indx];

    if (node.type !== "hidden" && node.type !== "constant") {
      console.trace();
      throw indx + ") Node must be a 'hidden' type was: " + node.type;
    }
    const left = this.nodes.slice(0, indx);
    const right = this.nodes.slice(indx + 1);
    right.forEach((n) => {
      n.index--;
    });

    const full = [...left, ...right];

    this.nodes = full;

    const tmpConnections: ConnectionInterface[] = [];

    this.connections.forEach((tmpC) => {
      const c = tmpC as Connection;
      if (c.from !== indx) {
        if (c.from > indx) c.from--;
        if (c.to !== indx) {
          if (c.to > indx) c.to--;

          if (Number.isInteger(c.gater)) {
            if (typeof c.gater === "undefined") {
              throw "not an integer: " + c.gater;
            }
            let tmpGater: number = c.gater;
            if (tmpGater !== indx) {
              if (tmpGater > indx) tmpGater--;

              c.gater = tmpGater;
              tmpConnections.push(c);
            }
          } else {
            tmpConnections.push(c);
          }
        }
      }
    });

    this.connections = tmpConnections;
    this.clearCache();
  }

  public addNode(focusList?: number[]) {
    const node = new Node(crypto.randomUUID(), "hidden", undefined, this);

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

    for (let attempts = 0; attempts < 10; attempts++) {
      if (attempts >= 9) {
        tmpFocusList =
          undefined; /* Should work first time once we remove the "focus" */
      }
      if (fromIndex === -1) {
        const pos = Math.floor(
          Math.random() * (node.index),
        );

        if (node.index <= pos) {
          throw "From: " + pos + " should be less than node index: " +
            node.index;
        }
        if (this.inFocus(pos, tmpFocusList)) {
          fromIndex = pos;
        }
      } else if (toIndex === -1) {
        const pos = Math.floor(
          Math.random() * (this.nodes.length - node.index),
        ) + node.index;

        if (node.index > pos) {
          throw "To: " + pos + " should be great than node index: " +
            node.index;
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
        Connection.randomWeight(),
      );
    } else {
      console.trace();
      console.warn("addNode: Should have a from index");
    }

    if (toIndex !== -1) {
      this.connect(
        node.index,
        toIndex,
        Connection.randomWeight(),
      );
      node.fix();
    } else {
      console.trace();
      console.warn("addNode: Should have a to index");
    }
  }

  private _insertNode(node: Node) {
    if (
      Number.isInteger(node.index) == false || node.index < this.input
    ) {
      console.trace();
      throw "to should be a greater than the input count was: " + node.index;
    }

    const firstOutputIndex = this.nodes.length - this.output;
    if (node.index > firstOutputIndex) {
      console.trace();
      throw "to should be a between than input (" + this.input +
        ") and output nodes (" + firstOutputIndex + ") was: " + node.index;
    }

    if (node.type !== "hidden") {
      console.trace();
      throw "Should be a 'hidden' type was: " + node.type;
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
      if (c.gater && c.gater >= node.index) c.gater++;
    });

    this.clearCache();
  }

  public addConnection(focusList?: number[]) {
    // Create an array of all uncreated (feedforward) connections
    const available = [];

    for (let i = 0; i < this.nodes.length - this.output; i++) {
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

        if (!(node1 as Node).isProjectingTo(node2 as Node)) {
          available.push([node1, node2]);
        }
      }
    }

    if (available.length === 0) {
      return;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    this.connect(
      pair[0].index,
      pair[1].index,
      Connection.randomWeight(),
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
          Connection.randomWeight(),
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
          Connection.randomWeight(),
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
    // const network = this.network as Network;
    const allConnections = this.connections.filter(
      (c) => {
        return this.inFocus(c.from, focusList) ||
          this.inFocus(c.to, focusList) ||
          (c.gater && this.inFocus(c.gater, focusList));
      },
    );
    if (allConnections.length > 0) {
      const pos = Math.floor(Math.random() * allConnections.length);
      const connection = allConnections[pos];
      if (connection) {
        const modification = Math.random() *
            (Mutation.MOD_WEIGHT.max - Mutation.MOD_WEIGHT.min) +
          Mutation.MOD_WEIGHT.min;
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
      (node as Node).mutate(Mutation.MOD_BIAS.name);
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
        (node as Node).mutate(Mutation.MOD_ACTIVATION.name);
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
    this.connect(node.index, node.index, Connection.randomWeight());
  }

  private subSelfCon(focusList?: number[]) {
    // Check which nodes aren't self connected yet
    const possible = [];
    for (let i = this.input; i < this.nodes.length; i++) {
      if (this.inFocus(i, focusList)) {
        const node = this.nodes[i];
        const c = this.getConnection(node.index, node.index);
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
    this.disconnect(node.index, node.index);
  }

  private addGate(focusList?: number[]) {
    // Create a list of all non-gated connections
    const possible = [];
    for (let i = this.input; i < this.connections.length; i++) {
      const conn = this.connections[i];
      if (!Number.isInteger(conn.gater)) {
        possible.push(conn);
      }
    }

    if (possible.length === 0) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      const conn = possible[Math.floor(Math.random() * possible.length)];
      if (
        this.inFocus(conn.to, focusList) || this.inFocus(conn.from, focusList)
      ) {
        // Select a random gater node and connection, can't be gated by input
        const index = Math.floor(
          Math.random() * (conn.to - this.input) +
            this.input,
        );
        conn.gater = index;

        break;
      }
    }

    this.clearCache();
  }

  private subGate(focusList?: number[]) {
    // Create a list of all non-gated connections
    const possible = [];
    for (let i = 0; i < this.connections.length; i++) {
      const conn = this.connections[i];
      if (conn.gater ? conn.gater : -1 >= 0) {
        possible.push(conn);
      }
    }

    if (possible.length === 0) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      const conn = possible[Math.floor(Math.random() * possible.length)];
      if (
        this.inFocus(conn.to, focusList) || this.inFocus(conn.from, focusList)
      ) {
        conn.gater = undefined;

        break;
      }
    }

    this.clearCache();
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
            if (!(node2 as Node).isProjectingTo(node1 as Node)) {
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
    this.connect(pair[0].index, pair[1].index, Connection.randomWeight());
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

  public swapNodes(focusList?: number[]) {
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

      (node1 as Node).fix();
      (node2 as Node).fix();
      if (this.DEBUG) this.validate();
    }
  }

  /**
   * Mutates the network with the given method
   */
  mutate(method: { name: string }, focusList?: number[]) {
    if (typeof method.name !== "string") {
      console.trace();
      throw "Mutate method wrong type: " + (typeof method);
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
      case Mutation.ADD_GATE.name: {
        this.addGate(focusList);

        break;
      }
      case Mutation.SUB_GATE.name: {
        this.subGate(focusList);

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
        throw "unknown: " + method;
      }
    }

    this.fix();
    if (this.DEBUG) {
      this.validate();
    }
  }

  /**
   * Fix the network
   */
  fix() {
    const maxTo = this.nodes.length - 1;
    const minTo = this.input;
    const maxFrom = this.nodes.length - this.output;

    const connections: Connection[] = [];
    this.connections.forEach((c) => {
      if (c.to > maxTo) {
        console.debug("Ignoring connection to above max", maxTo, c);
      } else if (c.to < minTo) {
        console.debug("Ignoring connection to below min", minTo, c);
      } else if (c.from > maxFrom) {
        console.debug("Ignoring connection from above max", maxFrom, c);
      } else {
        connections.push(c as Connection);
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
      (node as Node).fix();
    });
  }

  outputCount() {
    return this.output;
  }

  nodeCount() {
    return this.nodes.length;
  }

  /**
   * Convert the network to a json object
   */
  toJSON(options = { verbose: false }) {
    if (this.DEBUG) {
      this.validate();
    }

    const json = {
      uuid: this.uuid,
      nodes: new Array(
        this.nodes.length - (options.verbose ? 0 : this.input),
      ),
      connections: new Array(this.connections.length),
      input: this.input,
      output: this.output,
      tags: this.tags ? this.tags.slice() : undefined,
    };

    for (let i = this.nodes.length; i--;) {
      const node = this.nodes[i];
      if (!options.verbose && node.type == "input") continue;
      node.index = i;
      const tojson = (node as Node).toJSON();

      json.nodes[i - (options.verbose ? 0 : this.input)] = tojson;
    }

    for (let i = this.connections.length; i--;) {
      const tojson = (this.connections[i] as Connection).toJSON();

      json.connections[i] = tojson;
    }

    return json;
  }

  private loadFrom(json: NetworkInterface, validate: boolean) {
    this.uuid = json.uuid;
    this.nodes.length = json.nodes.length;
    if (json.tags) {
      this.tags = [...json.tags];
    }

    this.nodes = new Array(json.nodes.length);
    for (let i = json.input; i--;) {
      const n = new Node(`input-${i}`, "input", undefined, this);
      n.index = i;
      this.nodes[i] = n;
    }

    let pos = json.input;
    for (let i = 0; i < json.nodes.length; i++) {
      const jn = json.nodes[i];

      if (jn.type === "input") continue;

      const n = Node.fromJSON(jn, this);
      n.index = pos;
      this.nodes[pos] = n;
      pos++;
    }

    this.connections.length = 0;
    const cLen = json.connections.length;
    for (let i = 0; i < cLen; i++) {
      const conn = json.connections[i];

      const connection = this.connect(
        conn.from,
        conn.to,
        conn.weight,
        conn.type,
      );

      if (conn.gater != null) {
        connection.gater = conn.gater;
      }
    }

    this.clearCache();
    this.clear();

    if (validate) {
      this.validate();
    }
  }

  /**
   * Convert a json object to a network
   */
  static fromJSON(json: NetworkInterface, validate = false) {
    const network = new Network(json.input, json.output, false);
    network.loadFrom(json, validate);

    return network;
  }

  /**
   * Creates a json that can be used to create a graph with d3 and webcola
   */
  graph(width: number, height: number) {
    let input = 0;
    let output = 0;

    const json = {
      nodes: [],
      links: [],
      constraints: [{
        type: "alignment",
        axis: "x",
        offsets: [],
      }, {
        type: "alignment",
        axis: "y",
        offsets: [],
      }],
    };

    let i;
    for (i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];

      if (node.type === "input") {
        if (this.input === 1) {
          (json.constraints[0].offsets as { node: number; offset: number }[])
            .push({
              node: i,
              offset: 0,
            });
        } else {
          (json.constraints[0].offsets as { node: number; offset: number }[])
            .push({
              node: i,
              offset: 0.8 * width / (this.input - 1) * input++,
            });
        }
        (json.constraints[1].offsets as { node: number; offset: number }[])
          .push({
            node: i,
            offset: 0,
          });
      } else if (node.type === "output") {
        if (this.output === 1) {
          (json.constraints[0].offsets as { node: number; offset: number }[])
            .push({
              node: i,
              offset: 0,
            });
        } else {
          (json.constraints[0].offsets as { node: number; offset: number }[])
            .push({
              node: i,
              offset: 0.8 * width / (this.output - 1) * output++,
            });
        }
        (json.constraints[1].offsets as { node: number; offset: number }[])
          .push({
            node: i,
            offset: -0.8 * height,
          });
      }

      (json.nodes as {
        id: number;
        name: string;
        activation: number;
        bias: number;
      }[]).push({
        id: i,
        name: node.type === "hidden"
          ? (node.squash ? node.squash : "UNKNOWN")
          : node.type.toUpperCase(),
        activation: (node as Node).getActivation(),
        bias: node.bias ? node.bias : 0,
      });
    }

    for (i = 0; i < this.connections.length; i++) {
      const connection = this.connections[i];
      if (connection.gater == null) {
        (json.links as { from: number; to: number; weight: number }[]).push({
          from: connection.from,
          to: connection.to,
          weight: connection.weight,
        });
      } else {
        // Add a gater 'node'
        const index = json.nodes.length;
        (json.nodes as { id: number; activation: number; name: string }[]).push(
          {
            id: index,
            activation: (this.nodes[index] as Node).getActivation(),
            name: "GATE",
          },
        );
        (json.links as { source: number; target: number; weight: number }[])
          .push({
            source: connection.from,
            target: connection.to,
            weight: 1 / 2 * connection.weight,
          });
        (json.links as { source: number; target: number; weight: number }[])
          .push({
            source: index,
            target: connection.to,
            weight: 1 / 2 * connection.weight,
          });
        (json.links as {
          source: number;
          target: number;
          weight: number;
          gate: boolean;
        }[]).push({
          source: connection.gater,
          target: index,
          weight: (this.nodes[connection.gater] as Node)
            .getActivation(),
          gate: true,
        });
      }
    }

    return json;
  }
}