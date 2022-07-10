import { NetworkInterface } from "./NetworkInterface.ts";
import { Network } from "./network.js";
import { DataRecordInterface } from "./DataSet.ts";
import { make as makeConfig } from "../config/NeatConfig.ts";
import { NeatOptions } from "../config/NeatOptions.ts";

import { yellow } from "https://deno.land/std@0.146.0/fmt/colors.ts";
import { WorkerHandler } from "../multithreading/workers/WorkerHandler.ts";
import { Neat } from "../Neat.js";
import { addTags, getTag } from "../tags/TagsInterface.ts";
import { makeDataDir } from "../architecture/DataSet.ts";

import { TrainOptions } from "../config/TrainOptions.ts";
import { findCost, findRatePolicy } from "../config.ts";
import { emptyDirSync } from "https://deno.land/std@0.146.0/fs/empty_dir.ts";
import { Mutation } from "../methods/mutation.ts";
import { Node } from "../architecture/Node.ts";
import { Connection } from "./Connection.ts";
// import { NodeInterface } from "../architecture/NodeInterface.ts";

const cacheDataFile = {
  fn: "",
  json: {},
};

interface HashTable<T> {
  [key: string]: T;
}

export class NetworkUtil {
  private network;
  private cache: HashTable<ConnectionInterface[]> = {};

  constructor(
    network: NetworkInterface,
  ) {
    this.network = network;
  }

  private clearCache() {
    this.cache = {};

    // for (const member in this.cache) {
    //   throw "still has: " + member;
    // }
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

    const stats = {
      input: 0,
      hidden: 0,
      output: 0,
      connections: 0,
    };

    this.network.nodes.forEach((node, indx) => {
      switch (node.type) {
        case "input":
          stats.input++;
          break;
        case "hidden":
          stats.hidden++;
          break;
        case "output":
          stats.output++;
          break;
        default:
          throw indx + ") Invalid type: " + node.type;
      }

      if (node.index !== indx) {
        console.trace();
        throw indx + ") node.index: " + node.index +
          " does not match expected index";
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
        console.trace();
        throw indx + ") connection from an output node";
      }

      if (c.gater !== null) {
        const gaterNode = this.getNode(c.gater);

        if (gaterNode.type === "output") {
          throw indx + ") connection gater an output node";
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
    let results: ConnectionInterface[] = this.cache[key];
    if (results == null) {
      results = [];
      const tmpList = this.network.connections;
      tmpList.forEach((c) => {
        if (c.to === indx && c.from == indx) results.push(c);
      });

      this.cache[key] = results;
    }

    if (results.length > 0) {
      return results[0];
    } else {
      return null;
    }
  }

  toConnections(to: number): ConnectionInterface[] {
    const key = "to:" + to;
    let results: ConnectionInterface[] = this.cache[key];
    if (results == null) {
      results = [];
      const tmpList = this.network.connections;
      tmpList.forEach((c) => {
        if (c.to === to) results.push(c);
      });

      this.cache[key] = results;
    }
    return results;
  }

  fromConnections(from: number): ConnectionInterface[] {
    const key = "from:" + from;
    let results: ConnectionInterface[] = this.cache[key];
    if (results == null) {
      results = [];
      const tmpList = this.network.connections;
      tmpList.forEach((c) => {
        if (c.from === from) results.push(c);
      });

      this.cache[key] = results;
    }
    return results;
  }

  gateConnections(indx: number): ConnectionInterface[] {
    const key = "gate:" + indx;
    let results: ConnectionInterface[] = this.cache[key];
    if (results == null) {
      results = [];
      const tmpList = this.network.connections;
      tmpList.forEach((c) => {
        if (c.gate === indx) results.push(c);
      });

      this.cache[key] = results;
    }
    return results;
  }

  // private getIndex( node:Node):number{
  //   if( typeof node.index !== 'undefined'){
  //     return node.index;
  //   }

  //   this.network.nodes.findIndex( node);
  // }
  getNode(pos: number): Node {
    if (Number.isInteger(pos) == false || pos < 0) {
      console.trace();
      throw "POS should be a non-negative integer was: " + pos;
    }
    const tmp = this.network.nodes[pos];

    if (typeof tmp === "undefined") {
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

    const firstOutputIndex = this.network.nodes.length - this.network.output;
    if (from >= firstOutputIndex) {
      console.trace();
      throw "from should not be from an output node (" + firstOutputIndex +
        "): " + from;
    }
    if (Number.isInteger(to) == false || to < 0) {
      console.trace();
      throw "to should be a non-negative integer was: " + to;
    }

    if (to < this.network.input) {
      console.trace();
      throw "to should not be pointed to any input nodes(" +
        this.network.input + "): " + to;
    }
    if (typeof weight !== "number") {
      console.trace();
      throw "weight not a number was: " + weight;
    }

    this.clearCache();

    const connection = new Connection(
      from,
      to,
      weight,
      type,
    );

    let location = -1;
    for (let indx = 0; indx < this.network.connections.length; indx++) {
      const c = this.network.connections[indx];

      if (c.from > from) {
        location = indx;
        break;
      } else if (c.from === from) {
        if (c.to > to) {
          location = indx;
          break;
        } else if (c.to === to) {
          console.trace();

          throw indx + ") already connected from: " + from + " to: " + to;
        } else {
          location = indx + 1;
        }
      } else {
        location = indx + 1;
      }
    }

    if (location !== -1) {
      const left = this.network.connections.slice(0, location);
      const right = this.network.connections.slice(location);

      this.network.connections = [...left, connection, ...right];
    } else {
      this.network.connections.push(connection);
    }

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

    // if (connections) {
    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.from === from && connection.to === to) {
        if (connection.gater !== null) {
          this.ungate(connection);
        }
        connections.splice(i, 1);
        this.clearCache();
        break;
      }
    }
  }

  /**
   *  Remove the gate of a connection
   */
  ungate(connection: ConnectionInterface) {
    const index = this.network.gates.indexOf(connection);
    if (index === -1) {
      console.warn(
        "This connection is not gated!",
        this.network.gates,
        connection,
      );
      console.trace();
      return;
    }

    this.gates.splice(index, 1);
    connection.gater.ungate(connection);
  }

  /**
   * Backpropagate the network
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
      const n = this.network.nodes[i];
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
      const n = this.network.nodes[i];
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

    // Intialise the NEAT instance
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
        bestCreature = Network.fromJSON(fittest.toJSON());
      } else if (fittest.score < bestScore) {
        throw "fitness decreased over generations";
      }
      const timedOut = endTimeMS ? Date.now() > endTimeMS : false;

      if (options.log && (neat.generation % options.log === 0 || timedOut)) {
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
      this.network.nodes = bestCreature.nodes;
      this.network.connections = bestCreature.connections;
      // this.network.selfconns = bestCreature.selfconns;
      // this.network.gates = bestCreature.gates;
      addTags(this.network, bestCreature);

      if (options.clear && this.network.clear) this.network.clear();
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
    const dataSetDir = makeDataDir(dataSet, config.dataSetParitionBreak);

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
    // deno-lint-ignore ban-types
    cost: Function,
    feedbackLoop: boolean,
  ) {
    let error = 0;
    let counter = 0;

    const files: string[] = this.dataFiles(dataDir);

    files.forEach((name) => {
      const fn = dataDir + "/" + name;

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
        if (!this.network.noTraceActivate) throw "no trace function";
        const output = this.network.noTraceActivate(input);
        error += cost(target, output);
        if (!feedbackLoop && this.network.clear) this.network.clear();
      }
      counter += len;
    });

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
    const cost = findCost(options.cost ? options.cost : "MSE");
    const baseRate = options.rate || 0.3;
    const momentum = options.momentum || 0;
    const batchSize = options.batchSize || 1; // online learning
    const ratePolicyName = options.ratePolicy ? options.ratePolicy : "FIXED";
    const ratePolicy = findRatePolicy(ratePolicyName);

    const iterations = options.iterations ? options.iterations : 0;

    const files: string[] = this.dataFiles(dataDir);

    // Loops the training process
    let currentRate = 0.3;
    let iteration = 0;
    let error = 1;

    while (
      isFinite(error) &&
      error > targetError &&
      (iterations === 0 || iteration < iterations)
    ) {
      // if (options.crossValidate && error <= options.crossValidate.testError) break;

      iteration++;

      // Update the rate
      currentRate = ratePolicy(baseRate, iteration);

      if (!isFinite(currentRate)) throw "not a valid rate: " + currentRate;

      let counter = 0;
      let errorSum = 0;

      files.forEach((name) => {
        if (!isFinite(errorSum)) return;
        const fn = dataDir + "/" + name;
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

          if (!this.network.activate) throw "no activate funtion";
          const output = this.network.activate(input, true);

          errorSum += cost(target, output);
          if (!isFinite(errorSum)) break;

          this.propagate(currentRate, momentum, update, target);
        }
        if (this.network.clear) this.network.clear();
        counter += len;
      });

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

    if (options.clear && this.network.clear) this.network.clear();

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
    const dataSetDir = makeDataDir(dataSet, config.dataSetParitionBreak);

    const result = this.trainDir(dataSetDir, options);

    Deno.removeSync(dataSetDir, { recursive: true });

    return result;
  }

  private writeCreatures(neat: Neat, dir: string) {
    let counter = 1;
    emptyDirSync(dir);
    neat.population.forEach((creature: NetworkInterface) => {
      const json = creature.toJSON();

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

      const tmpList = this.network.connections;
      for (let i = tmpList.length; i--;) {
        const c = tmpList[i];
        if (c.to === index || c.from === index) return true;

        if (this.inFocus(c.from, focusList, checked)) {
          return true;
        }

        if (this.inFocus(c.to, focusList, checked)) {
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

    this.network.connections.forEach((c) => {
      if (c.from !== indx) {
        if (c.from > indx) c.from--;
        if (c.to !== indx) {
          if (c.to > indx) c.to--;
          if (Number.isInteger(c.gater)) {
            if (c.gater !== indx) {
              if (c.gater > indx) c.gater--;

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
    this.validate();
  }

  public addNode(focusList?: number[]) {
    const network = this.network as Network;

    const node = new Node("hidden", 0, network.util);

    // Random squash function
    node.mutate(Mutation.MOD_ACTIVATION.name);

    const pos = Math.floor(
      Math.random() *
        (network.nodes.length - network.output - network.input + 1),
    ) + network.input;
    network.util.insertNode(node, pos);

    let fromIndex = -1;
    let toIndex = -1;

    for (let attempts = 0; attempts < 12; attempts++) {
      if (fromIndex === -1) {
        let pos = Math.min(
          Math.floor(
            Math.random() * network.nodes.length,
          ),
          network.nodes.length - this.network.output - 1,
        );

        if (node.index === pos) pos--;
        if (this.inFocus(pos, focusList)) {
          fromIndex = pos;
        }
      } else if (toIndex === -1) {
        let pos = Math.max(
          Math.floor(
            Math.random() * network.nodes.length - this.network.input,
          ),
          0,
        ) + this.network.input;

        if (node.index === pos) pos++;
        if (this.inFocus(pos, focusList)) {
          toIndex = pos;
        }
      } else {
        break;
      }
    }

    if (fromIndex !== -1) {
      network.util.connect(
        fromIndex,
        node.index,
        Connection.randomWeight(),
      );
    }

    if (toIndex !== -1) {
      network.util.connect(
        node.index,
        toIndex,
        Connection.randomWeight(),
      );
    }
    this.validate();
  }

  private insertNode(node: Node, indx: number) {
    if (Number.isInteger(indx) == false || indx < this.network.input) {
      console.trace();
      throw "to should be a greater than the input count was: " + indx;
    }

    const firstOutputIndex = this.network.nodes.length - this.network.output;
    if (indx > firstOutputIndex) {
      console.trace();
      throw "to should be a between than input (" + this.network.input +
        ") and output nodes (" + firstOutputIndex + ") was: " + indx;
    }

    if (node.type !== "hidden") {
      console.trace();
      throw "Should be a 'hidden' type was: " + node.type;
    }
    const left = this.network.nodes.slice(0, indx);
    const right = this.network.nodes.slice(indx);
    right.forEach((n) => {
      n.index++;
    });

    node.index = indx;
    const full = [...left, node, ...right];

    this.network.nodes = full;

    this.network.connections.forEach((c) => {
      if (c.from >= indx) c.from++;
      if (c.to >= indx) c.to++;
      if (c.gater && c.gater >= indx) c.gater++;
    });

    this.clearCache();
    this.validate();
  }

  public addConnection(focusList?: number[]) {
    const network = this.network as Network;
    // Create an array of all uncreated (feedforward) connections
    const available = [];

    for (let i = 0; i < network.nodes.length - network.output; i++) {
      const node1 = network.nodes[i];

      if (!this.inFocus(i, focusList)) continue;

      for (
        let j = Math.max(i + 1, network.input);
        j < network.nodes.length;
        j++
      ) {
        const node2 = network.nodes[j];
        if (!this.inFocus(j, focusList)) continue;

        if (!node1.isProjectingTo(node2)) {
          available.push([node1, node2]);
        }
      }
    }

    if (available.length === 0) {
      return;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    network.util.connect(
      pair[0].index,
      pair[1].index,
      Connection.randomWeight(),
    );
  }

  private subConnection(focusList?: number[]) {
    const network = this.network as Network;
    // List of possible connections that can be removed
    const possible = [];

    for (let i = 0; i < network.connections.length; i++) {
      const conn = network.connections[i];
      // Check if it is not disabling a node
      if (
        // conn.from.connections.out.length > 1 &&
        // conn.to.connections.in.length > 1 &&
        conn.to > conn.from
      ) {
        if (
          this.inFocus(conn.to, focusList) || this.inFocus(conn.from, focusList)
        ) {
          possible.push(conn);
        }
      }
    }

    if (possible.length === 0) {
      return;
    }

    const randomConn = possible[Math.floor(Math.random() * possible.length)];
    network.util.disconnect(randomConn.from, randomConn.to);
  }

  private modWeight(focusList?: number[]) {
 
    // const network = this.network as Network;
    const allconnections = this.network.connections.filter(
      (c) => {
        return this.inFocus(c.from, focusList) || this.inFocus(c.to, focusList)|| (c.gater && this.inFocus(c.gater, focusList));
      },
    );
    if (allconnections.length > 0) {
      const pos = Math.floor(Math.random() * allconnections.length);
      const connection = allconnections[pos];
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
          allconnections.length,
        );
      }
    }
  }

  private modBias(focusList?: number[]) {
    const network = this.network as Network;
    for (let attempts = 0; attempts < 12; attempts++) {
      // Has no effect on input node, so they are excluded
      const index = Math.floor(
        Math.random() * (network.nodes.length - network.input) +
          network.input,
      );
      const node = network.nodes[index];
      if (!this.inFocus(index, focusList)) continue;
      node.mutate(Mutation.MOD_BIAS);
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
        node.mutate(Mutation.MOD_ACTIVATION);
        break;
      }
    }
  }

  private addSelfCon(focusList?: number[]) {
    const network = this.network as Network;
    // Check which nodes aren't selfconnected yet
    const possible = [];
    for (let i = network.input; i < network.nodes.length; i++) {
      const node = network.nodes[i];
      if (node.connections.self.weight === 0) {
        if (this.inFocus(node, focusList)) {
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
    network.connect(node, node);
  }

  private subSelfCon(focusList?: number[]) {
    console.trace();
    throw "not done";
    // const network = this.network as Network;
    // if (network.selfconns.length === 0) {
    //   return;
    // }

    // for (let attempts = 0; attempts < 12; attempts++) {
    //   const conn = network
    //     .selfconns[Math.floor(Math.random() * network.selfconns.length)];

    //   if (
    //     this.inFocus(conn.from, focusList) || this.inFocus(conn.to, focusList)
    //   ) {
    //     network.disconnect(conn.from, conn.to);
    //     break;
    //   }
    // }
  }

  private addGate(focusList?: number[]) {
    console.trace();
    throw "not done";
    // const network = this.network as Network;
    // const allconnections = network.connections.concat(network.selfconns);

    // // Create a list of all non-gated connections
    // const possible = [];
    // for (let i = 0; i < allconnections.length; i++) {
    //   const conn = allconnections[i];
    //   if (conn.gater === null) {
    //     possible.push(conn);
    //   }
    // }

    // if (possible.length === 0) {
    //   return;
    // }

    // for (let attempts = 0; attempts < 12; attempts++) {
    //   // Select a random gater node and connection, can't be gated by input
    //   const index = Math.floor(
    //     Math.random() * (network.nodes.length - network.input) +
    //       network.input,
    //   );
    //   const node = network.nodes[index];

    //   if (this.inFocus(node, focusList)) {
    //     const conn = possible[Math.floor(Math.random() * possible.length)];

    //     // Gate the connection with the node
    //     network.gate(node, conn);
    //     break;
    //   }
    // }
  }

  private subGate(focusList?: number[]) {
    console.trace();
    throw "not done";
    // const network = this.network as Network;
    // // Select a random gated connection
    // if (network.gates.length === 0) {
    //   return;
    // }

    // for (let attempts = 0; attempts < 12; attempts++) {
    //   const index = Math.floor(Math.random() * network.gates.length);
    //   const gatedconn = network.gates[index];

    //   if (
    //     this.inFocus(gatedconn.from, focusList) ||
    //     this.inFocus(gatedconn.to, focusList)
    //   ) {
    //     network.ungate(gatedconn);
    //     break;
    //   }
    // }
  }

  private addBackConn(focusList?: number[]) {
    const network = this.network as Network;

    // Create an array of all uncreated (backfed) connections
    const available = [];
    for (let i = network.input; i < network.nodes.length; i++) {
      const node1 = network.nodes[i];
      if (this.inFocus(node1, focusList)) {
        for (let j = network.input; j < i; j++) {
          const node2 = network.nodes[j];
          if (this.inFocus(node2, focusList)) {
            if (!node1.isProjectingTo(node2)) {
              available.push([node1, node2]);
            }
          }
        }
      }
    }

    if (available.length === 0) {
      return;
    }

    const pair = available[Math.floor(Math.random() * available.length)];
    network.connect(pair[0], pair[1]);
  }

  private subBackConn(focusList?: number[]) {
    const network = this.network as Network;
    // List of possible connections that can be removed
    const possible = [];

    for (let i = 0; i < network.connections.length; i++) {
      const conn = network.connections[i];
      // Check if it is not disabling a node
      if (
        conn.from.connections.out.length > 1 &&
        conn.to.connections.in.length > 1 &&
        network.nodes.indexOf(conn.from) > network.nodes.indexOf(conn.to)
      ) {
        if (
          this.inFocus(conn.from, focusList) || this.inFocus(conn.to, focusList)
        ) {
          possible.push(conn);
        }
      }
    }

    if (possible.length === 0) {
      return;
    }

    const randomConn = possible[Math.floor(Math.random() * possible.length)];
    network.disconnect(randomConn.from, randomConn.to);
  }

  private swapNodes(focusList?: number[]) {
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
              network.input) + network.input,
      );
      // const tmpNode = network.nodes[index1];
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
              network.input) + network.input,
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
    }
  }
  /**
   * Mutates the network with the given method
   */
  mutate(method: { name: string }, focusList?: number[]) {
    if (typeof method === "undefined") {
      throw new Error("No (correct) mutate method given!");
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
  }
}
