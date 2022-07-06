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
import { NodeInterface } from "../architecture/NodeInterface.ts";

const cacheDataFile = {
  fn: "",
  json: {},
};
export class NetworkUtil {
  private network;
  constructor(
    network: NetworkInterface,
  ) {
    this.network = network;
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
  connect(from: number, to: number, weight: number, type?: string) {
    if (Number.isInteger(from) == false || from < 0) {
      console.trace();
      throw "from should be a non-negative integer was: " + from;
    }
    if (Number.isInteger(to) == false || to < 0) {
      console.trace();
      throw "to should be a non-negative integer was: " + to;
    }
    if (typeof weight !== "number") {
      console.trace();
      throw "weight not a number was: " + weight;
    }
    const fromNode = this.getNode(from);
    const toNode = this.getNode(to);
    const _connections = fromNode.connect(toNode, weight, type);

    for (let i = 0; i < _connections.length; i++) {
      const connection = _connections[i];
      if (from !== to) {
        this.network.connections.push(connection);
      } else {
        if (!this.network.selfconns) {
          this.network.selfconns = [];
        }
        this.network.selfconns.push(connection);
      }
    }

    return _connections;
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
    const connections = from === to
      ? this.network.selfconns
      : this.network.connections;

    if (connections) {
      for (let i = 0; i < connections.length; i++) {
        const connection = connections[i];
        if (connection.from === from && connection.to === to) {
          if (connection.gater !== null) {
            this.ungate(connection);
          }
          connections.splice(i, 1);
          break;
        }
      }
    }

    const fromNode = this.getNode(from);

    const toNode = this.getNode(to);
    // Delete the connection at the sending and receiving neuron
    fromNode.disconnect(toNode, false);
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
      this.network.selfconns = bestCreature.selfconns;
      this.network.gates = bestCreature.gates;
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

  inFocus(node: Node, focusList?: number[], checked = new Set()) {
    if (!focusList || focusList.length == 0) return true;
    const network = this.network as Network;
    const nodeList = network.nodes;
    const index = nodeList.indexOf(node);
    if (index === -1) return false;

    // console.info( "Index", index, focusList);
    for (let pos = 0; pos < focusList.length; pos++) {
      const focusIndex = focusList[pos];

      if (index == focusIndex) {
        return true;
      }

      for (let k = 0; k < node.connections.in.length; k++) {
        const c = node.connections.in[k];
        const fromIndex = nodeList.indexOf(c.from);
        if (!checked.has(fromIndex)) {
          checked.add(fromIndex);
          if (this.inFocus(node.util.getNode(c.from), focusList, checked)) {
            return true;
          }
        }
        const toIndex = nodeList.indexOf(c.to);
        if (!checked.has(toIndex)) {
          checked.add(toIndex);
          if (this.inFocus(node.util.getNode(c.to), focusList, checked)) {
            return true;
          }
        }
      }

      // node.connections.out.forEach((c: unknown) => {
      //   const targetIndex =this.network.nodes.indexOf( c);
      //   if(! checked.has( targetIndex)){
      //     checked.add(targetIndex);
      //     if( this.inFocus( c, focusList, checked)){
      //       return true;
      //     }
      //   }
      // });

      // node.connections.gated.forEach((c: unknown) => {
      //   const targetIndex =this.network.nodes.indexOf( c);
      //   if(! checked.has( targetIndex)){
      //     checked.add(targetIndex);
      //     if( this.inFocus( c, focusList, checked)){
      //       return true;
      //     }
      //   }
      // });
    }
    return false;
  }

  private subNode(focusList?: number[]) {
    const network = this.network as Network;
    // Check if there are nodes left to remove
    if (network.nodes.length === network.input + network.output) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      // Select a node which isn't an input or output node
      const index = Math.floor(
        Math.random() *
            (network.nodes.length - network.output - network.input) +
          network.input,
      );
      const node = network.nodes[index];
      if (!this.inFocus(node, focusList)) continue;
      network.remove(node);
      break;
    }
  }

  private addNode(focusList?: number[]) {
    const network = this.network as Network;
    const connections = network.connections;

    // Look for an existing connection and place a node in between
    if (connections.length > 0) {
      for (let attempts = 0; attempts < 12; attempts++) {
        const pos = Math.floor(Math.random() * connections.length);
        const connection = connections[pos];
        if (connection) {
          if (
            !this.inFocus(connection.from, focusList) &&
            !this.inFocus(connection.to, focusList)
          ) {
            continue;
          }

          const gater = connection.gater;
          network.util.disconnect(connection.from, connection.to);

          // Insert the new node right before the old connection.to
          const toIndex = connection.to;
          const node = new Node("hidden", 0, network.util);

          // Random squash function
          node.mutate(Mutation.MOD_ACTIVATION.name);

          // Place it in this.nodes
          const minBound = Math.min(
            toIndex,
            network.nodes.length - network.output,
          );
          network.util.insertNode(node, minBound);
          // network.nodes.splice(minBound, 0, node);

          // Now create two new connections
          const newConn1 = network.util.connect(
            connection.from,
            node.index,
            Connection.randomWeight(),
          )[0];
          const newConn2 = network.util.connect(
            node.index,
            connection.to,
            Connection.randomWeight(),
          )[0];

          // Check if the original connection was gated
          if (gater != null) {
            network.gate(gater, Math.random() >= 0.5 ? newConn1 : newConn2);
          }
        } else {
          console.warn(
            "ADD_NODE: missing connection at",
            pos,
            "of",
            network.connections.length,
          );
        }

        break;
      }
    }
  }

  insertNode(node: Node, pos: number) {
    if (Number.isInteger(pos) == false || pos < 0) {
      console.trace();
      throw "to should be a non-negative integer was: " + pos;
    }

    const left = this.network.nodes.slice(0, pos);
    const right = this.network.nodes.slice(pos);
    right.forEach((n) => {
      n.index++;
    });

    node.index = pos;
    const full = [...left, node, ...right];

    this.network.nodes = full;

    this.network.connections.forEach((c) => {
      if (c.from >= pos) c.from++;
      if (c.to >= pos) c.to++;
      if (c.gater && c.gater >= pos) c.gater++;
    });
  }

  private addConnection(focusList?: number[]) {
    const network = this.network as Network;
    // Create an array of all uncreated (feedforward) connections
    const available = [];

    for (let i = 0; i < network.nodes.length - network.output; i++) {
      const node1 = network.nodes[i];

      if (!this.inFocus(node1, focusList)) continue;

      for (
        let j = Math.max(i + 1, network.input);
        j < network.nodes.length;
        j++
      ) {
        const node2 = network.nodes[j];
        if (!this.inFocus(node2, focusList)) continue;

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
        conn.from.connections.out.length > 1 &&
        conn.to.connections.in.length > 1 &&
        network.nodes.indexOf(conn.to) > network.nodes.indexOf(conn.from)
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
    network.disconnect(randomConn.from, randomConn.to);
  }

  private modWeight(focusList?: number[]) {
    const network = this.network as Network;
    const allconnections = network.connections.concat(network.selfconns).filter(
      (c) => {
        return this.inFocus(c.from, focusList) || this.inFocus(c.to, focusList);
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
      if (!this.inFocus(node, focusList)) continue;
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

      if (this.inFocus(node, focusList)) {
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
    const network = this.network as Network;
    if (network.selfconns.length === 0) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      const conn = network
        .selfconns[Math.floor(Math.random() * network.selfconns.length)];

      if (
        this.inFocus(conn.from, focusList) || this.inFocus(conn.to, focusList)
      ) {
        network.disconnect(conn.from, conn.to);
        break;
      }
    }
  }

  private addGate(focusList?: number[]) {
    const network = this.network as Network;
    const allconnections = network.connections.concat(network.selfconns);

    // Create a list of all non-gated connections
    const possible = [];
    for (let i = 0; i < allconnections.length; i++) {
      const conn = allconnections[i];
      if (conn.gater === null) {
        possible.push(conn);
      }
    }

    if (possible.length === 0) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      // Select a random gater node and connection, can't be gated by input
      const index = Math.floor(
        Math.random() * (network.nodes.length - network.input) +
          network.input,
      );
      const node = network.nodes[index];

      if (this.inFocus(node, focusList)) {
        const conn = possible[Math.floor(Math.random() * possible.length)];

        // Gate the connection with the node
        network.gate(node, conn);
        break;
      }
    }
  }

  private subGate(focusList?: number[]) {
    const network = this.network as Network;
    // Select a random gated connection
    if (network.gates.length === 0) {
      return;
    }

    for (let attempts = 0; attempts < 12; attempts++) {
      const index = Math.floor(Math.random() * network.gates.length);
      const gatedconn = network.gates[index];

      if (
        this.inFocus(gatedconn.from, focusList) ||
        this.inFocus(gatedconn.to, focusList)
      ) {
        network.ungate(gatedconn);
        break;
      }
    }
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
      const tmpNode = network.nodes[index1];
      if (this.inFocus(tmpNode, focusList)) {
        node1 = tmpNode;
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
      const tmpNode = network.nodes[index2];
      if (this.inFocus(tmpNode, focusList)) {
        node2 = tmpNode;
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

    // const network = this.network as Network;

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
