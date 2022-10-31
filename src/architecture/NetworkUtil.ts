import { NetworkInterface } from "./NetworkInterface.ts";
import { Network } from "./network.js";
import { DataRecordInterface } from "./DataSet.ts";
import { make as makeConfig } from "../config/NeatConfig.ts";
import { NeatOptions } from "../config/NeatOptions.ts";

import { yellow } from "https://deno.land/std@0.161.0/fmt/colors.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { Neat } from "../Neat.js";
import { addTags, getTag } from "../tags/TagsInterface.ts";
import { makeDataDir } from "../architecture/DataSet.ts";

import { TrainOptions } from "../config/TrainOptions.ts";
import { findRatePolicy } from "../config.ts";
import { emptyDirSync } from "https://deno.land/std@0.161.0/fs/empty_dir.ts";
import { Mutation } from "../methods/mutation.ts";
import { Node } from "../architecture/Node.ts";
import { Connection } from "./Connection.ts";
import { ConnectionInterface } from "./ConnectionInterface.ts";
import { LOGISTIC } from "../methods/activations/types/LOGISTIC.ts";
import { NetworkState } from "./NetworkState.ts";
import { CostInterface, Costs } from "../Costs.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { addTag } from "../tags/TagsInterface.ts";

const cacheDataFile = {
  fn: "",
  json: {},
};

function sleep(ms: number) {
  console.info(`Sleep ${ms}`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NetworkUtil {
  readonly network;
  readonly networkState = new NetworkState();
  private cache = new Map<string, ConnectionInterface[]>();
  DEBUG = ((globalThis as unknown) as { DEBUG: boolean }).DEBUG;

  constructor(
    network: NetworkInterface,
  ) {
    this.network = network;
  }

  /* Dispose of the network and all held memory */
  public dispose() {
    this.clear();
    this.clearCache();
    this.network.connections = [];
    this.network.nodes = [];
  }

  public clearCache() {
    this.cache.clear();
  }

  initialize(options: {
    layers?: { squash: string; count: number }[];
  }) {
    let fixNeeded = false;
    // Create input nodes
    for (let i = this.network.input; i--;) {
      const type = "input";
      const node = new Node(type, 0, this);
      node.index = this.network.nodes.length;
      this.network.nodes.push(node);
    }

    if (options.layers) {
      let lastStartIndx = 0;
      let lastEndIndx = this.network.nodes.length - 1;

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
            "hidden",
            undefined,
            this,
            tmpSquash,
          );
          node.index = this.network.nodes.length;
          this.network.nodes.push(node);
        }

        const tmpOutput = this.network.output;
        this.network.output = 0;

        for (let k = lastStartIndx; k <= lastEndIndx; k++) {
          for (let l = lastEndIndx + 1; l < this.network.nodes.length; l++) {
            this.connect(k, l, Connection.randomWeight());
          }
        }
        this.network.output = tmpOutput;
        lastStartIndx = lastEndIndx + 1;
        lastEndIndx = this.network.nodes.length - 1;
      }

      // Create output nodes
      for (let i = this.network.output; i--;) {
        const type = "output";
        const node = new Node(type, undefined, this);
        node.index = this.network.nodes.length;
        this.network.nodes.push(node);
      }

      for (let k = lastStartIndx; k <= lastEndIndx; k++) {
        for (let l = lastEndIndx + 1; l < this.network.nodes.length; l++) {
          this.connect(k, l, Connection.randomWeight());
        }
      }
    } else {
      // Create output nodes
      for (let i = this.network.output; i--;) {
        const type = "output";
        const node = new Node(type, undefined, this);
        node.index = this.network.nodes.length;
        this.network.nodes.push(node);
      }

      // Connect input nodes with output nodes directly
      for (let i = 0; i < this.network.input; i++) {
        for (
          let j = this.network.input;
          j < this.network.output + this.network.input;
          j++
        ) {
          /** https://stats.stackexchange.com/a/248040/147931 */
          const weight = Math.random() * this.network.input *
            Math.sqrt(2 / this.network.input);
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
    if (input && input.length != this.network.input) {
      console.trace();
      throw "Activate input: " + input.length +
        " does not match expected input: " + this.network.input;
    }
    if (!feedbackLoop) {
      this.networkState.clear();
    }
    const output: number[] = new Array(this.network.output);
    const ns = this.networkState;
    for (let i = this.network.input; i--;) {
      ns.node(i).activation = input[i];
    }

    const lastHiddenNode = this.network.nodes.length - this.network.output;

    /* Activate nodes chronologically */
    for (let i = this.network.input; i < lastHiddenNode; i++) {
      (this.network.nodes[i] as Node).activate();
    }

    for (let i = 0; i < this.network.output; i++) {
      output[i] = (this.network.nodes[i + lastHiddenNode] as Node).activate();
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
    const output: number[] = new Array(this.network.output);
    const ns = this.networkState;
    for (let i = this.network.input; i--;) {
      ns.node(i).activation = input[i];
    }

    const lastHiddenNode = this.network.nodes.length - this.network.output;

    /* Activate nodes chronologically */
    for (let i = this.network.input; i < lastHiddenNode; i++) {
      (this.network.nodes[i] as Node).noTraceActivate();
    }

    for (let i = 0; i < this.network.output; i++) {
      output[i] = (this.network.nodes[i + lastHiddenNode] as Node)
        .noTraceActivate();
    }

    return output;
  }

  /**
   * Compact the network.
   */
  compact(): Network | null {
    const json = this.toJSON();
    const compactNetwork = NetworkUtil.fromJSON(json);
    compactNetwork.util.fix();

    let complete = false;
    for (let changes = 0; complete == false; changes++) {
      complete = true;
      for (
        let pos = compactNetwork.input;
        pos < compactNetwork.nodes.length - compactNetwork.output;
        pos++
      ) {
        const toList = compactNetwork.util.toConnections(pos).filter((c) => {
          return c.from !== c.to;
        });
        if (toList.length == 1) {
          const fromList = compactNetwork.util.fromConnections(pos).filter(
            (c) => {
              return c.from !== c.to;
            },
          );
          if (fromList.length == 1) {
            const to = fromList[0].to;
            const from = toList[0].from;
            if (
              from > this.network.input &&
              compactNetwork.nodes[from].type == compactNetwork.nodes[pos].type
            ) {
              if (compactNetwork.util.getConnection(from, to) == null) {
                let weightA = fromList[0].weight * toList[0].weight;

                const biasA =
                  compactNetwork.nodes[from].bias * toList[0].weight +
                  compactNetwork.nodes[pos].bias;

                compactNetwork.nodes[from].bias = biasA;

                compactNetwork.util.removeHiddenNode(pos);
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

                compactNetwork.util.connect(
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

    const json2 = compactNetwork.util.toJSON();
    if (JSON.stringify(json, null, 2) != JSON.stringify(json2, null, 2)) {
      addTag(compactNetwork, "approach", "compact");
      addTag(compactNetwork, "old-nodes", this.network.nodes.length.toString());
      addTag(
        compactNetwork,
        "old-connections",
        this.network.connections.length.toString(),
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
      if (this.network.nodes.length !== options.nodes) {
        throw "Node length: " + this.network.nodes.length + " expected: " +
          options.nodes;
      }
    }

    if (!this.network || (this.network as Network).util !== this) {
      throw "Network and Util don't match";
    }

    if (
      Number.isInteger(this.network.input) == false || this.network.input < 1
    ) {
      console.trace();
      throw "Must have at least one input nodes was: " + this.network.input;
    }

    if (
      Number.isInteger(this.network.output) == false || this.network.output < 1
    ) {
      console.trace();
      throw "Must have at least one output nodes was: " + this.network.output;
    }

    if (typeof (this.network as Network).util.toJSON !== "function") {
      console.trace();
      throw "missing toJSON function was: " +
        (typeof (this.network as Network).util.toJSON);
    }

    const stats = {
      input: 0,
      constant: 0,
      hidden: 0,
      output: 0,
      connections: 0,
    };

    this.network.nodes.forEach((node, indx) => {
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
              JSON.stringify((this.network as Network).util.toJSON(), null, 2),
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

            console.info(this.network.connections);
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

            console.info(this.network.connections);
            throw indx + ") '" + node.type + "' node has inward connections: " +
              toList.length;
          }
          break;
        }
        case "hidden": {
          stats.hidden++;
          const toList = this.toConnections(indx);
          if (toList.length == 0) {
            console.trace();
            console.info(this.network.connections);
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
                  (this.network as Network).util.toJSON(),
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
      if ((node as Node).util !== this) {
        console.trace();
        throw indx + ") node.util mismatch";
      }
    });

    if (stats.input !== this.network.input) {
      console.trace();
      throw "Expected " + this.network.input + " input nodes found: " +
        stats.input;
    }
    if (stats.output !== this.network.output) {
      console.trace();
      throw "Expected " + this.network.output + " output nodes found: " +
        stats.output;
    }

    let lastFrom = -1;
    let lastTo = -1;
    this.network.connections.forEach((c, indx) => {
      stats.connections++;
      const toNode = this.getNode(c.to);

      if (toNode.type === "input") {
        console.info(JSON.stringify(this.network.connections, null, 1));
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
        console.info(JSON.stringify(this.network.connections, null, 1));
        console.trace();
        throw indx + ") connections not sorted";
      } else if (c.from > lastFrom) {
        lastTo = -1;
      }

      if (c.from == lastFrom && c.to <= lastTo) {
        console.info(JSON.stringify(this.network.connections, null, 1));
        console.trace();
        throw indx + ") connections not sorted";
      }

      lastFrom = c.from;
      lastTo = c.to;
    });

    if (options && Number.isInteger(options.connections)) {
      if (this.network.connections.length !== options.connections) {
        console.trace();
        throw "Connections length: " + this.network.connections.length +
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
      const tmpList = this.network.connections;
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
      const tmpList = this.network.connections;
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
      const tmpList = this.network.connections;
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
      const tmpList = this.network.connections;
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
      const tmpList = this.network.connections;
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
    const tmp = this.network.nodes[pos];

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

    for (let pos = this.network.connections.length; pos--;) {
      const c = this.network.connections[pos];

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

    const firstOutputIndex = this.network.nodes.length - this.network.output;
    if (from >= firstOutputIndex && from !== to) {
      console.trace();
      throw "from should not be from an output node (" + firstOutputIndex +
        ", len: " + this.network.nodes.length + ", output: " +
        this.network.output +
        "): " + from;
    }

    if (to < this.network.input) {
      console.trace();
      throw "to should not be pointed to any input nodes(" +
        this.network.input + "): " + to;
    }

    if (to < from) {
      console.trace();
      throw "to: " + to + " should not be less than from: " + from;
    }

    if (typeof weight !== "number") {
      if (this.DEBUG) {
        this.DEBUG = false;
        console.warn(
          JSON.stringify((this.network as Network).util.toJSON(), null, 2),
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

    for (let indx = this.network.connections.length; indx--;) {
      const c = this.network.connections[indx];

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
    if (location !== -1 && location < this.network.connections.length) {
      const left = this.network.connections.slice(0, location);
      const right = this.network.connections.slice(location);

      this.network.connections = [...left, connection, ...right];
    } else {
      this.network.connections.push(connection);
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
    const connections = this.network.connections;

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
    const oldConnections = this.network.connections.length;
    const oldNodes = this.network.nodes.length;
    let changed = false;
    for (
      let i = this.network.nodes.length;
      i--;
    ) {
      const n = (this.network.nodes[i] as Node);
      if (n.type == "input") break;
      changed ||= n.applyLearnings();
    }

    if (changed) {
      this.fix();
      const temp = this.compact();
      if (temp != null) {
        this.loadFrom(temp.util.toJSON(), true);
      }
      addTag(this.network, "approach", "Learnings");
      addTag(this.network, "old-nodes", oldNodes.toString());
      addTag(
        this.network,
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
      typeof target === "undefined" || target.length !== this.network.output
    ) {
      throw new Error(
        "Output target length should match network output length",
      );
    }

    let targetIndex = target.length;

    // Propagate output nodes
    for (
      let i = this.network.nodes.length - 1;
      i >= this.network.nodes.length - this.network.output;
      i--
    ) {
      const n = (this.network.nodes[i] as Node);
      n.propagate(
        rate,
        momentum,
        update,
        target[--targetIndex],
      );
    }

    // Propagate hidden and input nodes
    for (
      let i = this.network.nodes.length - this.network.output - 1;
      i >= this.network.input;
      i--
    ) {
      const n = (this.network.nodes[i] as Node);
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
      this.network.input,
      this.network.output,
      options,
      workers,
    );

    await neat.populatePopulation(this.network);

    let error = Infinity;
    let bestScore = -Infinity;
    let bestCreature = null;

    if (config.pauseMS) {
      await sleep(config.pauseMS);
    }

    let iterationStartMS = new Date().getTime();

    while (
      error > config.targetError &&
      (!options.iterations || neat.generation < options.iterations)
    ) {
      const fittest = await neat.evolve(bestCreature);

      if (fittest.score > bestScore) {
        const errorTmp = getTag(fittest, "error");
        if (errorTmp) {
          error = Number.parseFloat(errorTmp);
        } else {
          throw "No error: " + errorTmp;
        }

        bestScore = fittest.score;
        bestCreature = NetworkUtil.fromJSON(fittest.util.toJSON());
      } else if (fittest.score < bestScore) {
        throw "fitness decreased over generations";
      }
      const timedOut = endTimeMS ? Date.now() > endTimeMS : false;

      if (
        options.log &&
        (neat.generation % options.log === 0 || timedOut ||
          error <= config.targetError)
      ) {
        const now = new Date().getTime();
        console.log(
          "iteration",
          neat.generation,
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

        if (config.pauseMS) {
          await sleep(config.pauseMS);
        }
        iterationStartMS = new Date().getTime();
      }

      if (timedOut) break;
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
      iterations: neat.generation,
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
      dataSet[0].input.length !== this.network.input ||
      dataSet[0].output.length !== this.network.output
    ) {
      throw new Error(
        "Dataset input(" + dataSet[0].input.length + ")/output(" +
          dataSet[0].output.length + ") size should be same as network input(" +
          this.network.input + ")/output(" + this.network.output + ") size!",
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

    for (let j = files.length; j--;) {
      const fn = files[j];

      const json = cacheDataFile.fn == fn
        ? cacheDataFile.json
        : JSON.parse(Deno.readTextFileSync(fn));

      if (files.length == 1) {
        cacheDataFile.fn = fn;
        cacheDataFile.json = json;
      } else {
        cacheDataFile.fn = "";
        cacheDataFile.json = {};
      }
      if (json.length == 0) {
        throw "Set size must be positive";
      }

      for (let i = json.length; i--;) {
        const data = json[i];

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
    if (typeof options.iterations === "undefined") {
      console.warn(
        "No target iterations given, running until error is reached!",
      );
    }

    // Read the options
    const targetError = options.error || 0.05;
    const cost = Costs.find(options.cost ? options.cost : "MSE");
    const baseRate = options.rate || 0.3;
    const momentum = options.momentum || 0;
    const batchSize = options.batchSize || 1; // online learning
    const ratePolicyName = options.ratePolicy ? options.ratePolicy : "FIXED";
    const ratePolicy = findRatePolicy(ratePolicyName);

    const iterations = options.iterations ? options.iterations : 0;

    const files: string[] = this.dataFiles(dataDir).map((fn) =>
      dataDir + "/" + fn
    );

    // Loops the training process
    let currentRate = 0.3;
    let iteration = 0;
    let error = 1;

    while (
      Number.isFinite(error) &&
      error > targetError &&
      (iterations === 0 || iteration < iterations)
    ) {
      iteration++;

      // Update the rate
      currentRate = ratePolicy(baseRate, iteration);

      if (!Number.isFinite(currentRate)) {
        throw "not a valid rate: " + currentRate;
      }

      let counter = 0;
      let errorSum = 0;

      for (let j = files.length; j--;) {
        const fn = files[j];
        const json = cacheDataFile.fn == fn
          ? cacheDataFile.json
          : JSON.parse(Deno.readTextFileSync(fn));

        if (files.length == 1) {
          cacheDataFile.fn = fn;
          cacheDataFile.json = json;
        } else {
          cacheDataFile.fn = "";
          cacheDataFile.json = {};
        }

        if (json.length == 0) {
          throw "Set size must be positive";
        }
        const len = json.length;

        for (let i = len; i--;) {
          const data = json[i];
          const input = data.input;
          const target = data.output;
          const update = !!((i + 1) % batchSize === 0 || i === 0);

          const output = this.activate(input);

          errorSum += cost.calculate(target, output);

          this.propagate(currentRate, momentum, update, target);
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
      dataSet[0].input.length !== this.network.input ||
      dataSet[0].output.length !== this.network.output
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
      const json = (creature as Network).util.toJSON();

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
      // const tmpList = this.network.connections;
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
    const network = this.network as Network;
    // Check if there are nodes left to remove
    if (network.nodes.length === network.input + network.output) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      // Select a node which isn't an input or output node
      const indx = Math.floor(
        Math.random() *
            (network.nodes.length - network.output - network.input) +
          network.input,
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

    const node = this.network.nodes[indx];

    if (node.type !== "hidden") {
      console.trace();
      throw indx + ") Node must be a 'hidden' type was: " + node.type;
    }
    const left = this.network.nodes.slice(0, indx);
    const right = this.network.nodes.slice(indx + 1);
    right.forEach((n) => {
      n.index--;
    });

    const full = [...left, ...right];

    this.network.nodes = full;

    const tmpConnections: ConnectionInterface[] = [];

    this.network.connections.forEach((tmpC) => {
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

    this.network.connections = tmpConnections;
    this.clearCache();
  }

  public addNode(focusList?: number[]) {
    const network = this.network as Network;

    const node = new Node("hidden", undefined, this);

    // Random squash function
    node.mutate(Mutation.MOD_ACTIVATION.name);

    node.index = Math.floor(
      Math.random() *
        (network.nodes.length - network.output - network.input + 1),
    ) + network.input;

    network.util._insertNode(node);

    let tmpFocusList = focusList;
    let fromIndex = -1;
    let toIndex = -1;

    for (let attempts = 0; true; attempts++) {
      if (attempts > 9) tmpFocusList = undefined;
      if (fromIndex === -1) {
        const pos = Math.min(
          Math.floor(
            Math.random() * network.nodes.length,
          ),
          network.nodes.length - this.network.output - 1,
        );

        if (node.index <= pos) continue;
        if (this.inFocus(pos, tmpFocusList)) {
          fromIndex = pos;
        }
      } else if (toIndex === -1) {
        const pos = Math.max(
          Math.floor(
            Math.random() * network.nodes.length - this.network.input,
          ),
          0,
        ) + this.network.input;

        if (node.index >= pos) continue;

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
        node.index,
        Connection.randomWeight(),
      );
    } else {
      console.trace();
      throw "Should have a from index";
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
      throw "Should have a to index";
    }
  }

  private _insertNode(node: Node) {
    if (
      Number.isInteger(node.index) == false || node.index < this.network.input
    ) {
      console.trace();
      throw "to should be a greater than the input count was: " + node.index;
    }

    const firstOutputIndex = this.network.nodes.length - this.network.output;
    if (node.index > firstOutputIndex) {
      console.trace();
      throw "to should be a between than input (" + this.network.input +
        ") and output nodes (" + firstOutputIndex + ") was: " + node.index;
    }

    if (node.type !== "hidden") {
      console.trace();
      throw "Should be a 'hidden' type was: " + node.type;
    }
    const left = this.network.nodes.slice(0, node.index);
    const right = this.network.nodes.slice(node.index);
    right.forEach((n) => {
      n.index++;
    });

    const full = [...left, node, ...right];

    this.network.nodes = full;

    this.network.connections.forEach((c) => {
      if (c.from >= node.index) c.from++;
      if (c.to >= node.index) c.to++;
      if (c.gater && c.gater >= node.index) c.gater++;
    });

    this.clearCache();
  }

  public addConnection(focusList?: number[]) {
    const network = this.network as Network;
    // Create an array of all uncreated (feedforward) connections
    const available = [];

    for (let i = 0; i < network.nodes.length - network.output; i++) {
      const node1 = network.nodes[i];

      if (node1.index != i) {
        throw i + ") invalid node index: " + node1.index;
      }

      if (!this.inFocus(i, focusList)) continue;

      for (
        let j = Math.max(i + 1, network.input);
        j < network.nodes.length;
        j++
      ) {
        if (!this.inFocus(j, focusList)) continue;
        const node2 = network.nodes[j];

        if (node2.type === "constant") continue;

        if (!node1.isProjectingTo(node2)) {
          node1.isProjectingTo(node2);
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
        this.network.nodes.length - this.network.output - 1,
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
    const firstOutputIndex = this.network.nodes.length - this.network.output;
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
    const network = this.network as Network;
    // List of possible connections that can be removed
    const possible = [];

    for (let i = 0; i < network.connections.length; i++) {
      const conn = network.connections[i];
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
              this.network.nodes[conn.from].type === "input"
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
    const allConnections = this.network.connections.filter(
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
    const network = this.network as Network;
    for (let attempts = 0; attempts < 12; attempts++) {
      // Has no effect on input node, so they are excluded
      const index = Math.floor(
        Math.random() * (network.nodes.length - network.input) +
          network.input,
      );
      const node = network.nodes[index];
      if (node.type === "constant") continue;
      if (!this.inFocus(index, focusList)) continue;
      node.mutate(Mutation.MOD_BIAS.name);
      break;
    }
  }

  private modActivation(focusList?: number[]) {
    const network = this.network as Network;

    for (let attempts = 0; attempts < 12; attempts++) {
      const index = Math.floor(
        Math.random() * (
              network.nodes.length -
              network.input
            ) + network.input,
      );
      const node = network.nodes[index];

      if (this.inFocus(index, focusList)) {
        node.mutate(Mutation.MOD_ACTIVATION.name);
        break;
      }
    }
  }

  private addSelfCon(focusList?: number[]) {
    const network = this.network as Network;
    // Check which nodes aren't self connected yet
    const possible = [];
    for (
      let i = network.input;
      i < network.nodes.length - network.output;
      i++
    ) {
      if (this.inFocus(i, focusList)) {
        const node = network.nodes[i];

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
    const network = this.network as Network;
    // Check which nodes aren't self connected yet
    const possible = [];
    for (let i = network.input; i < network.nodes.length; i++) {
      if (this.inFocus(i, focusList)) {
        const node = network.nodes[i];
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
    const network = this.network as Network;

    // Create a list of all non-gated connections
    const possible = [];
    for (let i = network.connections.length; i--;) {
      const conn = network.connections[i];
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
          Math.random() * (conn.to - network.input) +
            network.input,
        );
        conn.gater = index;

        break;
      }
    }

    this.clearCache();
  }

  private subGate(focusList?: number[]) {
    const network = this.network as Network;

    // Create a list of all non-gated connections
    const possible = [];
    for (let i = 0; i < network.connections.length; i++) {
      const conn = network.connections[i];
      if (conn.gater >= 0) {
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
    const network = this.network as Network;

    // Create an array of all uncreated (back feed) connections
    const available = [];
    for (let i = network.input; i < network.nodes.length; i++) {
      if (this.inFocus(i, focusList)) {
        const node1 = network.nodes[i];
        for (let j = network.input; j < i; j++) {
          const node2 = network.nodes[j];
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
    this.connect(pair[0].index, pair[1].index, Connection.randomWeight());
  }

  private subBackConn(focusList?: number[]) {
    const network = this.network as Network;

    // Create an array of all uncreated (back fed) connections
    const available = [];
    for (let i = network.input; i < network.nodes.length; i++) {
      if (this.inFocus(i, focusList)) {
        const node1 = network.nodes[i];
        for (let j = network.input; j < i; j++) {
          const node2 = network.nodes[j];
          if (node2.type == "output") break;
          if (this.inFocus(node2.index, focusList)) {
            if (node2.isProjectingTo(node1)) {
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
    this.disconnect(pair[0].index, pair[1].index);
  }

  public swapNodes(focusList?: number[]) {
    const network = this.network as Network;
    // Has no effect on input node, so they are excluded
    if (
      (network.nodes.length - network.input < 2) ||
      (network.nodes.length - network.input - network.output < 2)
    ) {
      return;
    }

    let node1 = null;
    for (let attempts = 0; attempts < 12; attempts++) {
      const index1 = Math.floor(
        Math.random() *
            (network.nodes.length -
              network.input - network.output) + network.input,
      );

      if (this.inFocus(index1, focusList)) {
        node1 = network.nodes[index1];
        break;
      }
    }
    if (node1 == null) return;
    let node2 = null;
    for (let attempts = 0; attempts < 12; attempts++) {
      const index2 = Math.floor(
        Math.random() *
            (network.nodes.length -
              network.input - network.output) + network.input,
      );

      if (this.inFocus(index2, focusList)) {
        node2 = network.nodes[index2];
        break;
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
    const maxTo = this.network.nodes.length - 1;
    const minTo = this.network.input;
    const maxFrom = this.network.nodes.length - this.network.output;

    const connections: Connection[] = [];
    this.network.connections.forEach((c) => {
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

    this.network.connections = connections;
    this.clearCache();

    let nodeRemoved = true;

    while (nodeRemoved) {
      nodeRemoved = false;
      for (
        let pos = this.network.input;
        pos < this.network.nodes.length - this.network.output;
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
          // } else if (
          //   this.toConnections(pos).length == 0
          // ) {
          //   this.removeHiddenNode(pos);
          //   nodeRemoved = true;
          //   break;
        }
      }
    }

    this.network.nodes.forEach((node) => {
      (node as Node).fix();
    });
  }

  outputCount() {
    return this.network.output;
  }

  nodeCount() {
    return this.network.nodes.length;
  }

  /**
   * Convert the network to a json object
   */
  toJSON(options = { verbose: false }) {
    if (this.DEBUG) {
      this.validate();
    }

    const json = {
      nodes: new Array(
        this.network.nodes.length - (options.verbose ? 0 : this.network.input),
      ),
      connections: new Array(this.network.connections.length),
      input: this.network.input,
      output: this.network.output,
      tags: this.network.tags ? this.network.tags.slice() : undefined,
    };

    for (let i = this.network.nodes.length; i--;) {
      const node = this.network.nodes[i];
      if (!options.verbose && node.type == "input") continue;
      node.index = i;
      const tojson = (node as Node).toJSON();

      json.nodes[i - (options.verbose ? 0 : this.network.input)] = tojson;
    }

    for (let i = this.network.connections.length; i--;) {
      const tojson = (this.network.connections[i] as Connection).toJSON();

      json.connections[i] = tojson;
    }

    return json;
  }

  /**
   * Create an offspring from two parent networks
   */
  static crossOver(network1: Network, network2: Network) {
    if (
      network1.input !== network2.input || network1.output !== network2.output
    ) {
      throw new Error("Networks don't have the same input/output size!");
    }

    // Initialize offspring
    const offspring = new Network(network1.input, network1.output, false);
    offspring.connections = [];
    offspring.nodes = [];

    let size;

    if (network1.nodes.length == network2.nodes.length) {
      size = network1.nodes.length;
    } else {
      if (
        network1.score > network2.score &&
        network1.nodes.length > network2.nodes.length
      ) {
        size = network1.nodes.length;
      } else if (
        network2.score > network1.score &&
        network2.nodes.length > network1.nodes.length
      ) {
        size = network2.nodes.length;
      } else {
        // Determine offspring node size
        const max = Math.max(network1.nodes.length, network2.nodes.length);
        const min = Math.min(network1.nodes.length, network2.nodes.length);
        size = Math.floor(Math.random() * (max - min + 1) + min);
      }
    }
    // Rename some variables for easier reading

    // Set indexes so we don't need indexOf
    for (let i = network1.nodes.length; i--;) {
      network1.nodes[i].index = i;
    }

    for (let i = network2.nodes.length; i--;) {
      network2.nodes[i].index = i;
    }

    const connectionsMap = new Map<number, ConnectionInterface[]>();
    // Assign nodes from parents to offspring
    for (let i = 0; i < size; i++) {
      // Determine if an output node is needed
      let node;
      if (i < size - network1.output) {
        const random = Math.random();
        node = random >= 0.5 ? network1.nodes[i] : network2.nodes[i];
        const other = random < 0.5 ? network1.nodes[i] : network2.nodes[i];

        if (typeof node === "undefined" || node.type === "output") {
          if (other.type === "output") {
            console.trace();
            throw i + ") Should not be an 'output' node";
          }

          node = other;
        }
      } else {
        if (Math.random() >= 0.5) {
          node = network1.nodes[network1.nodes.length + i - size];
        } else {
          node = network2.nodes[network2.nodes.length + i - size];
        }
        if (node.type !== "output") {
          console.trace();
          throw i + ") expected 'output' was: " + node.type;
        }
      }

      connectionsMap.set(i, node.util.toConnections(node.index));
      const newNode = new Node(
        node.type,
        node.bias,
        offspring.util,
        node.squash,
      );

      addTags(newNode, node);

      newNode.index = i;
      offspring.nodes.push(newNode);
    }
    offspring.util.clear();

    for (let indx = offspring.nodes.length; indx--;) {
      const toList = connectionsMap.get(indx);
      if (toList) {
        for (let i = toList.length; i--;) {
          const c = toList[i];

          const adjustTo = c.to + (indx - c.to);
          let adjustFrom = c.from;
          if (c.to == c.from) {
            adjustFrom = adjustTo;
          } else if (c.from >= offspring.input) {
            adjustFrom = adjustTo - (c.to - c.from);
            if (adjustFrom < offspring.input) {
              if (c.from < adjustTo) {
                adjustFrom = c.from;
              } else {
                adjustFrom = adjustFrom < 0 ? 0 : adjustFrom;
              }
            }
          }

          while (offspring.nodes[adjustFrom].type === "output") {
            adjustFrom--;
          }
          if (offspring.util.getConnection(adjustFrom, adjustTo) == null) {
            const co = offspring.util.connect(
              adjustFrom,
              adjustTo,
              c.weight,
              c.type,
            );
            if (c.gater !== undefined) {
              if (c.gater < adjustTo) {
                co.gater = c.gater;
              } else {
                co.gater = adjustTo - (c.to - c.gater);
                if (co.gater < 0) {
                  co.gater = 0;
                }
              }
            }
          }
        }
      }
    }
    offspring.util.fix();
    return offspring;
  }

  private loadFrom(json: NetworkInterface, validate: boolean) {
    this.network.nodes.length = json.nodes.length;
    if (json.tags) {
      this.network.tags = [...json.tags];
    }

    this.network.nodes = new Array(json.nodes.length);
    for (let i = json.input; i--;) {
      const n = new Node("input", undefined, this);
      n.index = i;
      this.network.nodes[i] = n;
    }

    let pos = json.input;
    for (let i = 0; i < json.nodes.length; i++) {
      const jn = json.nodes[i];

      if (jn.type === "input") continue;

      const n = Node.fromJSON(jn, this);
      n.index = pos;
      this.network.nodes[pos] = n;
      pos++;
    }

    this.network.connections.length = 0;
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
    network.util.loadFrom(json, validate);

    return network;
  }
}
